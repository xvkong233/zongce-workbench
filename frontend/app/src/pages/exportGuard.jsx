import { Table } from 'antd'
import { api } from '../api.js'

// 导出前综测数据有误检查：有则弹窗展示明细名单。
// 返回 true = 跳过提醒继续导出；false = 已前往处理或关闭弹窗（不导出）。
export async function confirmExportWithIssues({ modal, navigate, yearId, gradeIds = [], classIds = [] }) {
  let students = []
  if (yearId) {
    try {
      const r = await api('/overview/eval-mismatches', { params: { academic_year_id: yearId } })
      students = (r.students || []).filter((s) =>
        (!gradeIds.length || gradeIds.includes(s.grade_id))
        && (!classIds.length || classIds.includes(s.class_id)))
    } catch { /* 检查接口异常时不阻塞导出 */ }
  }
  if (!students.length) return true

  const totalItems = students.reduce((n, s) => n + s.items.length, 0)
  const rows = students.flatMap((s) => s.items.map((it) => ({
    key: `${s.student_no}|${it.item_name}`,
    student: `${s.name}（${s.student_no}）`,
    class_name: s.class_name,
    ...it,
  })))
  return new Promise((resolve) => {
    modal.confirm({
      title: `导出提醒：${students.length} 名学生的综测明细与得分不一致`,
      width: 760,
      okText: '跳过并导出',
      cancelText: '前往处理',
      closable: false,
      keyboard: false,
      maskClosable: false,
      onOk: () => resolve(true),
      onCancel: () => { navigate('/evals'); resolve(false) },
      content: (
        <div>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>
            以下学生的综测「±明细求和」与得分不一致（按封顶填写的已忽略），
            会影响综合测评成绩的准确性，建议前往「综测录入」核对修正后再导出。
          </div>
          <Table size="small" pagination={false} scroll={{ y: 280 }}
            dataSource={rows.slice(0, 50)}
            columns={[
              { title: '学生', dataIndex: 'student', width: 170 },
              { title: '班级', dataIndex: 'class_name', width: 130 },
              { title: '项目', dataIndex: 'item_name', width: 120 },
              { title: '明细求和', dataIndex: 'soft_sum', width: 90 },
              { title: '得分', dataIndex: 'score', width: 70 },
              { title: '差额', dataIndex: 'diff', width: 80,
                render: (v) => <span style={{ color: '#fa541c' }}>{v > 0 ? `+${v}` : v}</span> },
            ]} />
          {rows.length > 50 && (
            <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
              仅显示前 50 项，共 {totalItems} 项（{students.length} 名学生）
            </div>
          )}
        </div>
      ),
    })
  })
}
