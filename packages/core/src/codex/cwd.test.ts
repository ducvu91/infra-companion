import { describe, expect, it } from 'vitest'
import { CODEX_WORKSPACE_DIR, WORKSPACE_DRIVE_ORDER, workspaceCandidates } from './cwd'

describe('workspaceCandidates', () => {
  it('thu muc VUA DUNG dung dau tien', () => {
    // User đã làm ở đó thì đừng đoán lại giúp họ.
    const got = workspaceCandidates(['D:\\work\\my-project'], WORKSPACE_DRIVE_ORDER)
    expect(got[0]).toBe('D:\\work\\my-project')
  })

  it('giu THU TU recent (moi nhat truoc)', () => {
    const got = workspaceCandidates(['D:\\a', 'D:\\b'], [])
    expect(got).toEqual(['D:\\a', 'D:\\b'])
  })

  it('D: truoc C: — o du lieu truoc o he thong', () => {
    const got = workspaceCandidates([], ['D:\\', 'C:\\'])
    expect(got).toEqual([`D:\\${CODEX_WORKSPACE_DIR}`, `C:\\${CODEX_WORKSPACE_DIR}`])
  })

  it('khong co D: thi roi ve C:', () => {
    // Nơi gọi chỉ truyền ổ ĐANG CÓ, nên máy một ổ sẽ ra đúng C:.
    expect(workspaceCandidates([], ['C:\\'])).toEqual([`C:\\${CODEX_WORKSPACE_DIR}`])
  })

  it('khong co o nao va khong co home -> RONG (de user tu chon)', () => {
    // Trống mà thật thì hơn một mặc định gây lỗi.
    expect(workspaceCandidates([], [])).toEqual([])
  })

  it('ten thu muc co tien to ten app — thay o goc o thi biet cua gi', () => {
    expect(CODEX_WORKSPACE_DIR).toMatch(/InfraCompanion/)
  })

  it('POSIX: dat duoi ~ chu KHONG o goc filesystem', () => {
    // Ghi vào `/` cần quyền root và là chỗ không ai để dự án.
    const got = workspaceCandidates([], [], '/home/deploy')
    expect(got).toEqual([`/home/deploy/${CODEX_WORKSPACE_DIR}`])
  })

  it('POSIX: bo dau / thua o cuoi home', () => {
    expect(workspaceCandidates([], [], '/home/deploy/')).toEqual([`/home/deploy/${CODEX_WORKSPACE_DIR}`])
  })

  it('sinh duong dan Windows dung kieu (dau \\)', () => {
    const got = workspaceCandidates([], ['D:\\'])
    expect(got[0]!.includes('/')).toBe(false)
  })

  it('bo qua recent la chuoi trang, va bo o rong', () => {
    expect(workspaceCandidates(['', '  '], ['', 'C:\\'])).toEqual([`C:\\${CODEX_WORKSPACE_DIR}`])
  })

  it('bo trung lap khi recent trung dung thu muc mac dinh', () => {
    const dup = `D:\\${CODEX_WORKSPACE_DIR}`
    const got = workspaceCandidates([dup], ['D:\\', 'C:\\'])
    expect(got.filter((p) => p === dup)).toHaveLength(1)
    expect(got[0]).toBe(dup)
  })

  it('thu tu o mac dinh la D roi C', () => {
    expect(WORKSPACE_DRIVE_ORDER).toEqual(['D:\\', 'C:\\'])
  })
})
