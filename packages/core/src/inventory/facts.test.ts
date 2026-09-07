import { describe, expect, test } from 'vitest'
import { diffFacts, emptyFacts, filterFactsRows, formatUptime } from '@infra/shared'
import { FACTS_COMMAND, factsToCsv, parseFacts, splitSections } from './facts'

/** Fixture: output giả lập của một máy Ubuntu — CHỈ địa chỉ tài liệu (10.20.30.x, 203.0.113.x). */
const OUTPUT = `Welcome banner from login script
@@hostname
app-01
@@os
PRETTY_NAME="Ubuntu 22.04.4 LTS"
NAME="Ubuntu"
VERSION_ID="22.04"
@@kernel
5.15.0-105-generic
@@arch
x86_64
@@cpu
4
@@mem
MemTotal:        8123456 kB
@@disk
Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/sda1         40000000 18000000  20000000      47% /
@@uptime
1063412.35 4123456.00
@@ip
10.20.30.40 203.0.113.10 fe80::1
@@ports
LISTEN 0      128          0.0.0.0:22        0.0.0.0:*
LISTEN 0      511          0.0.0.0:80        0.0.0.0:*
LISTEN 0      511          0.0.0.0:443       0.0.0.0:*
LISTEN 0      80         127.0.0.1:3306      0.0.0.0:*
LISTEN 0      128             [::]:22           [::]:*
@@virt
kvm
@@reboot
yes
@@php
PHP 8.3.6 (cli) (built: Apr 15 2024 19:21:47) (NTS)
Copyright (c) The PHP Group
@@nginx
nginx version: nginx/1.24.0 (Ubuntu)
@@apache
@@mysql
mysqld  Ver 8.0.36-0ubuntu0.22.04.1 for Linux on x86_64 ((Ubuntu))
@@node
v20.11.1
@@docker
Docker version 26.1.3, build b72abbb
@@python
Python 3.10.12
@@end
`

describe('FACTS_COMMAND', () => {
  test('một dòng, không $(...) / $? / heredoc, có đánh dấu từng mục và @@end', () => {
    expect(FACTS_COMMAND).not.toMatch(/\$\(|\$\?|<</)
    expect(FACTS_COMMAND.split('\n')).toHaveLength(1)
    expect(FACTS_COMMAND).toContain('echo @@os; cat /etc/os-release')
    expect(FACTS_COMMAND.endsWith('echo @@end')).toBe(true)
  })
})

describe('splitSections / parseFacts', () => {
  test('cắt đúng mục, bỏ banner trước dấu đầu', () => {
    const sec = splitSections(OUTPUT)
    expect(sec['hostname']).toBe('app-01')
    expect(sec['apache']).toBe('')
    expect(sec['end']).toBeUndefined()
    expect(Object.keys(sec)).not.toContain('Welcome')
  })

  test('parse đủ facts của máy Ubuntu mẫu', () => {
    const f = parseFacts(OUTPUT)
    expect(f.hostname).toBe('app-01')
    expect(f.os).toBe('Ubuntu 22.04.4 LTS')
    expect(f.kernel).toBe('5.15.0-105-generic')
    expect(f.arch).toBe('x86_64')
    expect(f.cpuCount).toBe(4)
    expect(f.memTotalMb).toBe(7933)
    expect(f.diskRootPct).toBe(47)
    expect(f.uptimeSec).toBe(1_063_412)
    expect(f.ipv4).toEqual(['10.20.30.40', '203.0.113.10'])
    expect(f.listenPorts).toEqual([22, 80, 443, 3306])
    expect(f.virt).toBe('kvm')
    expect(f.rebootRequired).toBe(true)
    expect(f.versions).toEqual({ php: '8.3.6', nginx: '1.24.0', mysql: '8.0.36-0ubuntu0.22.04.1', node: '20.11.1', docker: '26.1.3', python: '3.10.12' })
  })

  test('thiếu lệnh → null/rỗng, không ném; "command not found" bị coi là không có', () => {
    const f = parseFacts('@@hostname\n@@os\nNAME="Alpine Linux"\nVERSION_ID=3.19.1\n@@virt\nnone\n@@php\nsh: php: not found\n@@ports\ntcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN\n@@end')
    expect(f.hostname).toBeNull()
    expect(f.os).toBe('Alpine Linux 3.19.1')
    expect(f.virt).toBeNull()
    expect(f.versions['php']).toBeUndefined()
    expect(f.listenPorts).toEqual([22]) // netstat format
    expect(f.rebootRequired).toBe(false)
  })

  test('MariaDB qua client mysql: lấy Distrib, không lấy "Ver 15.1" của client', () => {
    const f = parseFacts('@@mysql\nmysql  Ver 15.1 Distrib 10.11.6-MariaDB, for debian-linux-gnu (x86_64)\n@@end')
    expect(f.versions['mysql']).toBe('10.11.6-MariaDB')
  })

  test('output rỗng → emptyFacts', () => {
    expect(parseFacts('')).toEqual(emptyFacts())
  })
})

describe('diffFacts / filterFactsRows / factsToCsv / formatUptime', () => {
  const base = parseFacts(OUTPUT)

  test('diff: chỉ trường đổi, uptime bỏ qua, version thêm/mất đều ra', () => {
    const next = { ...base, kernel: '5.15.0-110-generic', uptimeSec: 5, versions: { ...base.versions, php: '8.3.8', docker: undefined as unknown as string } }
    delete (next.versions as Record<string, string>)['docker']
    const changes = diffFacts(base, next)
    expect(changes.map((c) => c.field)).toEqual(['kernel', 'versions.docker', 'versions.php'])
    expect(changes[2]).toEqual({ field: 'versions.php', before: '8.3.6', after: '8.3.8' })
    expect(changes[1]).toEqual({ field: 'versions.docker', before: '26.1.3', after: '' })
    expect(diffFacts(null, base)).toEqual([])
  })

  test('lọc AND theo từ, không phân biệt hoa thường, cổng gõ dạng :3306', () => {
    const rows = [
      { label: 'app-01', facts: base },
      { label: 'db-01', facts: { ...base, versions: { mysql: '10.11.6-MariaDB' }, listenPorts: [22, 3306] } }
    ]
    expect(filterFactsRows(rows, 'php 8.3').map((r) => r.label)).toEqual(['app-01'])
    expect(filterFactsRows(rows, 'MariaDB').map((r) => r.label)).toEqual(['db-01'])
    expect(filterFactsRows(rows, ':3306').map((r) => r.label)).toEqual(['app-01', 'db-01'])
    expect(filterFactsRows(rows, 'ubuntu kvm reboot')).toHaveLength(2)
    expect(filterFactsRows(rows, '')).toHaveLength(2)
    expect(filterFactsRows(rows, 'windows')).toEqual([])
  })

  test('CSV: header cố định + cột phiên bản, escape dấu phẩy/nháy', () => {
    const csv = factsToCsv([{ label: 'app, "one"', hostId: 'h1', collectedAt: 0, facts: base }])
    const [header, row] = csv.trimEnd().split('\n')
    expect(header).toBe('label,hostname,os,kernel,arch,cpu,mem_mb,disk_root_pct,uptime_sec,ipv4,listen_ports,virt,reboot_required,php,nginx,apache,mysql,node,docker,python,collected_at')
    expect(row).toContain('"app, ""one""",app-01,Ubuntu 22.04.4 LTS,5.15.0-105-generic,x86_64,4,7933,47,1063412,10.20.30.40 203.0.113.10,22 80 443 3306,kvm,yes,8.3.6,1.24.0,,8.0.36-0ubuntu0.22.04.1,20.11.1,26.1.3,3.10.12,1970-01-01T00:00:00.000Z')
  })

  test('formatUptime', () => {
    expect(formatUptime(null)).toBe('')
    expect(formatUptime(1_063_412)).toBe('12d 7h')
    expect(formatUptime(12_000)).toBe('3h 20m')
  })
})
