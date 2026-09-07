import { describe, expect, test } from 'vitest'
import {
  decodeTextFile,
  detectClientFormat,
  parseClientFile,
  parseCsv,
  parseMobaXterm,
  parsePuttyReg,
  parseTermiusCsv,
  parseWinScpIni
} from './clientImport'

/** Fixture CHỈ dùng tên/địa chỉ tài liệu (RFC 5737, example.com, deploy/admin) — CLAUDE.md §3. */

const PUTTY_REG = `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Default%20Settings]
"HostName"=""
"PortNumber"=dword:00000016

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\web-01%20prod]
"HostName"="deploy@203.0.113.10"
"PortNumber"=dword:00000016
"Protocol"="ssh"
"PublicKeyFile"="C:\\\\keys\\\\deploy.ppk"

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\gate]
"HostName"="gate.example.com"
"PortNumber"=dword:000008ae
"UserName"="admin"
"Protocol"="ssh"

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\switch]
"HostName"="10.20.30.40"
"Protocol"="telnet"

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\raw-thing]
"HostName"="10.20.30.41"
"Protocol"="raw"

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Jumplist]
"Recent sessions"=hex(7):00,00
`

describe('parsePuttyReg', () => {
  test('tách user@host, dword hex → port, %20 trong tên, bỏ Default Settings và giao thức lạ', () => {
    const { drafts, warnings } = parsePuttyReg(PUTTY_REG)
    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toEqual({
      label: 'web-01 prod',
      hostname: '203.0.113.10',
      port: 22,
      username: 'deploy',
      groupPath: null,
      protocol: 'ssh',
      keyPath: 'C:\\keys\\deploy.ppk'
    })
    expect(drafts[1]).toMatchObject({ label: 'gate', hostname: 'gate.example.com', port: 2222, username: 'admin' })
    expect(drafts[2]).toMatchObject({ label: 'switch', protocol: 'telnet', port: 23 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('raw-thing')
  })

  test('rỗng → không host, không warning', () => {
    expect(parsePuttyReg('')).toEqual({ drafts: [], warnings: [] })
  })
})

const MOBA = `[Bookmarks]
SubRep=
ImgNum=42
gate-01=#109#0%gate.example.com%22%admin%%-1%-1%%%%%0%0%0%%%-1%0%0%0%%1080%%0%0%1#MobaFont%10#0# #-1

[Bookmarks_1]
SubRep=Production\\Web
ImgNum=41
app-01=#109#0%203.0.113.10%22%deploy%%-1%-1#MobaFont%10#0# #-1
app-02=#109#0%203.0.113.11%%deploy%%-1%-1#MobaFont%10#0# #-1
win-01=#91#4%203.0.113.20%3389%administrator%#0# #-1
kvm=#128#5%10.20.30.99%5900%%#0# #-1
ftp-old=#130#6%10.20.30.50%21%%#0# #-1

[Other]
Foo=bar
`

describe('parseMobaXterm', () => {
  test('thư mục theo SubRep (đổi \\ → /), map loại 109/91/128, port trống → mặc định theo giao thức', () => {
    const { drafts, warnings } = parseMobaXterm(MOBA)
    expect(drafts.map((d) => d.label)).toEqual(['gate-01', 'app-01', 'app-02', 'win-01', 'kvm'])
    expect(drafts[0]).toMatchObject({ groupPath: null, hostname: 'gate.example.com', username: 'admin', protocol: 'ssh' })
    expect(drafts[1]).toMatchObject({ groupPath: 'Production/Web', hostname: '203.0.113.10', port: 22, username: 'deploy' })
    expect(drafts[2]).toMatchObject({ port: 22 })
    expect(drafts[3]).toMatchObject({ protocol: 'rdp', port: 3389, username: 'administrator' })
    expect(drafts[4]).toMatchObject({ protocol: 'vnc', port: 5900, username: null })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('ftp-old')
  })
})

const WINSCP = `[Configuration]
RandomSeedFile=x

[Sessions\\Default%20Settings]
HostName=

[Sessions\\Production%2Fapp-01]
HostName=203.0.113.10
PortNumber=22
UserName=deploy
FSProtocol=5
PublicKeyFile=C%3A%5Ckeys%5Cdeploy.ppk

[Sessions\\db-01]
HostName=10.20.30.40
PortNumber=2222
UserName=admin
FSProtocol=0

[Sessions\\ftp-site]
HostName=ftp.example.com
FSProtocol=2
`

describe('parseWinScpIni', () => {
  test('tên %-encode với thư mục %2F, key path decode, bỏ Default Settings và FTP', () => {
    const { drafts, warnings } = parseWinScpIni(WINSCP)
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toEqual({
      label: 'app-01',
      hostname: '203.0.113.10',
      port: 22,
      username: 'deploy',
      groupPath: 'Production',
      protocol: 'ssh',
      keyPath: 'C:\\keys\\deploy.ppk'
    })
    expect(drafts[1]).toMatchObject({ label: 'db-01', port: 2222, username: 'admin', groupPath: null })
    expect(warnings[0]).toContain('ftp-site')
  })
})

describe('parseCsv / parseTermiusCsv', () => {
  test('parseCsv: nháy kép, "" escape, xuống dòng trong ô, CRLF, bỏ dòng trống', () => {
    const rows = parseCsv('a,"b, c","say ""hi"""\r\n\r\n1,"multi\nline",3\n')
    expect(rows).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'multi\nline', '3']
    ])
  })

  test('Termius: header chuẩn, group → thư mục, protocol lạ bị bỏ, port trống theo giao thức', () => {
    const csv = [
      'Groups,Label,Tags,Hostname/IP,Protocol,Port,Username,Password',
      'Production,app-01,web,203.0.113.10,ssh,22,deploy,',
      'Production/DB,db-01,,10.20.30.40,,2222,admin,secret-not-read',
      ',switch,,10.20.30.41,telnet,,,',
      ',weird,,10.20.30.42,mosh,60001,,',
      ',,,,ssh,22,,'
    ].join('\n')
    const { drafts, warnings } = parseTermiusCsv(csv)
    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toEqual({ label: 'app-01', hostname: '203.0.113.10', port: 22, username: 'deploy', groupPath: 'Production', protocol: 'ssh', keyPath: null })
    expect(drafts[1]).toMatchObject({ groupPath: 'Production/DB', port: 2222, username: 'admin' })
    expect(drafts[2]).toMatchObject({ protocol: 'telnet', port: 23, label: 'switch' })
    expect(warnings).toHaveLength(2) // mosh + dòng không host
  })

  test('CSV chung: chỉ cần một cột host dưới tên khác; thiếu cột host thì nói rõ', () => {
    const { drafts } = parseTermiusCsv('name,address,user\nweb-01,web-01.example.net,deploy\n')
    expect(drafts[0]).toMatchObject({ label: 'web-01', hostname: 'web-01.example.net', username: 'deploy', port: 22 })
    expect(parseTermiusCsv('a,b\n1,2\n').warnings[0]).toContain('Hostname/IP')
    expect(parseTermiusCsv('').warnings[0]).toContain('trống')
  })
})

describe('detectClientFormat / parseClientFile / decodeTextFile', () => {
  test('theo đuôi file, rồi theo nội dung', () => {
    expect(detectClientFormat('putty.reg', PUTTY_REG)).toBe('putty')
    expect(detectClientFormat('x.reg', 'Windows Registry Editor Version 5.00\n[HKEY_CURRENT_USER\\Software\\Other]')).toBeNull()
    expect(detectClientFormat('MobaXterm Sessions.mxtsessions', MOBA)).toBe('mobaxterm')
    expect(detectClientFormat('WinSCP.ini', WINSCP)).toBe('winscp')
    expect(detectClientFormat('other.ini', '[General]\nx=1')).toBeNull()
    expect(detectClientFormat('hosts.csv', 'a,b')).toBe('termius')
    expect(detectClientFormat('renamed.txt', MOBA)).toBe('mobaxterm')
    expect(detectClientFormat('notes.txt', 'hello')).toBeNull()
  })

  test('parseClientFile gom format + source + drafts', () => {
    const p = parseClientFile('WinSCP.ini', WINSCP)
    expect(p?.format).toBe('winscp')
    expect(p?.source).toBe('WinSCP.ini')
    expect(p?.drafts).toHaveLength(2)
    expect(parseClientFile('notes.txt', 'hello')).toBeNull()
  })

  test('decodeTextFile: UTF-16LE BOM (Regedit), UTF-8 BOM, UTF-8 thường', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('ab', 'utf16le')])
    expect(decodeTextFile(utf16)).toBe('ab')
    expect(decodeTextFile(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi')
    expect(decodeTextFile(Buffer.from('xin chào', 'utf8'))).toBe('xin chào')
  })
})
