import { useEffect, useState } from 'react'
import { Alert, App as AntdApp, Descriptions, Drawer, Select, Table, Tag } from 'antd'
import { api } from '../api.js'

const fmt = (v) => (v === null || v === undefined ? '—' : v)

/**
 * 学生报告抽屉（综测汇总页 / 学生管理页共用）。
 * - 传入 fixedYearId：固定学年模式，只展示该学年明细（综测汇总页用法）。
 * - 不传 fixedYearId：浏览模式，先展示历年总览 + 学年切换，再展示所选学年明细（学生管理页用法）。
 * student: {student_id, student_no, name, class_name}，传 null/undefined 关闭。
 */
export default function StudentReportDrawer({ student, fixedYearId, onClose }) {
  const { message } = AntdApp.useApp()
  const [yearId, setYearId] = useState(null)
  const [summaries, setSummaries] = useState(null) // 浏览模式：历年总览
  const [report, setReport] = useState(null)

  useEffect(() => {
    setReport(null); setSummaries(null); setYearId(null)
    if (!student) return
    if (fixedYearId) {
      setYearId(fixedYearId)
      loadDetail(fixedYearId)
    } else {
      api('/export/student-report', { params: { student_id: student.student_id } })
        .then((d) => {
          const list = d.summaries || []
          setSummaries(list)
          const first = list.find((x) => x.has_data) || list[0]
          if (first) { setYearId(first.academic_year_id); loadDetail(first.academic_year_id) }
        })
        .catch((e) => message.error(e.message))
    }
  }, [student, fixedYearId])

  const loadDetail = (y) => {
    if (!student || !y) return
    api('/export/student-report', { params: { student_id: student.student_id, academic_year_id: y } })
      .then(setReport)
      .catch((e) => message.error(e.message))
  }

  const switchYear = (y) => { setYearId(y); setReport(null); loadDetail(y) }
  const title = student ? `${student.name} · ${student.student_no}` : '学生报告'

  return (
    <Drawer title={title} width={760} open={!!student} onClose={onClose}
      destroyOnHidden>
      {!fixedYearId && Array.isArray(summaries) && (
        <>
          <b>历年总览（排名为专业组内名次）</b>
          <Table size="small" style={{ margin: '8px 0 16px' }} rowKey="academic_year_id"
            pagination={false} dataSource={summaries}
            locale={{ emptyText: '暂无学年数据' }}
            onRow={(r) => ({ onClick: () => switchYear(r.academic_year_id),
                             style: { cursor: 'pointer', background: r.academic_year_id === yearId ? '#e6f4ff' : undefined } })}
            columns={[
              { title: '学年', dataIndex: 'year', width: 110,
                render: (v, r) => <a onClick={() => switchYear(r.academic_year_id)}>{v}</a> },
              { title: '成绩', dataIndex: 'score_count', width: 70,
                render: (v, r) => v > 0 ? `${v} 条` : '—' },
              { title: '学业加权平均', dataIndex: 'weighted_avg', width: 110, render: fmt },
              { title: '平均绩点', dataIndex: 'avg_gpa', width: 90, render: fmt },
              { title: '综测', dataIndex: 'eval_total', width: 100,
                render: (v, r) => r.eval_entered ? v : '未录入' },
              { title: '综合测评成绩', dataIndex: 'final_score', width: 110, render: fmt },
              { title: '智育排名', dataIndex: 'academic_rank', width: 90, render: fmt },
              { title: '综测排名', dataIndex: 'eval_rank', width: 90, render: fmt },
              { title: '特殊成绩', dataIndex: 'special_count', width: 80,
                render: (v) => v > 0 ? <Tag color="orange">{v}</Tag> : '—' },
            ]} />
        </>
      )}

      {summaries !== null && !fixedYearId && summaries.length > 0 && (
        <Select style={{ width: 180, marginBottom: 16 }} value={yearId}
          options={summaries.map((x) => ({ value: x.academic_year_id, label: x.year }))}
          onChange={switchYear} />
      )}

      {report && (
        <>
          <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}
            title={`${report.year} 学年`}
            extra={<Tag>{report.student.class_name}</Tag>}>
            <Descriptions.Item label="学业加权平均">{report.summary.weighted_avg?.toFixed(2) ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="平均绩点">{report.summary.avg_gpa?.toFixed(2) ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="智育排名">{report.summary.academic_rank ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="综合素质测评">
              {report.summary.eval_entered ? report.summary.eval_total : '未录入'}
            </Descriptions.Item>
            <Descriptions.Item label="综合测评成绩">{report.summary.final_score?.toFixed(2) ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="综测排名">{report.summary.eval_rank ?? '—'}</Descriptions.Item>
          </Descriptions>
          <b>综测明细</b>
          <Table size="small" style={{ margin: '8px 0 16px' }} rowKey="item_name" pagination={false}
            dataSource={report.evals}
            locale={{ emptyText: '该学年未录入综测' }}
            columns={[
              { title: '项目', dataIndex: 'item_name', width: 130 },
              { title: '得分', dataIndex: 'score', width: 80 },
              { title: '加减分明细', dataIndex: 'detail_text',
                render: (t) => <div style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{t}</div> },
            ]} />
          <b>课程成绩（{report.scores.length} 门，特殊成绩 {report.summary.special_count} 条）</b>
          <Table size="small" style={{ marginTop: 8 }} rowKey={(r) => r.course_code + r.semester}
            pagination={{ pageSize: 15 }}
            dataSource={report.scores}
            columns={[
              { title: '学期', dataIndex: 'semester', width: 70 },
              { title: '课程代码', dataIndex: 'course_code', width: 130 },
              { title: '课程名称', dataIndex: 'course_name' },
              { title: '学分', dataIndex: 'credit', width: 60 },
              { title: '成绩', width: 80, render: (_, r) => r.score_num ?? <Tag>{r.score_raw || '特殊'}</Tag> },
              { title: '绩点', dataIndex: 'gpa', width: 70 },
            ]} />
        </>
      )}
      {student && !fixedYearId && summaries !== null && summaries.length === 0 && (
        <Alert type="info" showIcon message="该学生暂无任何学年数据" />
      )}
    </Drawer>
  )
}
