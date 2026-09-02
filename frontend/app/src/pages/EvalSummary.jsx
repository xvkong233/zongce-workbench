import { useEffect, useState } from 'react'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { App as AntdApp, Button, Input, Select, Table, Tag } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { api, download } from '../api.js'
import { useClasses, useGrades, useYears } from './hooks.js'
import StudentReportDrawer from './StudentReportDrawer.jsx'

export default function EvalSummary() {
  const { message } = AntdApp.useApp()
  const years = useYears()
  const grades = useGrades()
  const [yearId, setYearId] = useState(null)
  const [gradeId, setGradeId] = useState(null)
  const classes = useClasses(gradeId)
  const [classId, setClassId] = useState(null)
  const [major, setMajor] = useState(null)
  const [keyword, setKeyword] = useState('')
  const [data, setData] = useState(null)
  const [reportOf, setReportOf] = useState(null)

  const majorOptions = [...new Set(classes.map((c) => c.major_effective).filter(Boolean))]
    .map((m) => ({ value: m, label: m }))

  const load = async () => {
    if (!yearId || !gradeId) return
    try {
      setData(await api('/summary', {
        params: { academic_year_id: yearId, grade_id: gradeId, class_id: classId, keyword, major },
      }))
    } catch (e) { message.error(e.message) }
  }
  useEffect(() => { load() }, [yearId, gradeId, classId, keyword, major])

  const doExport = async (brief) => {
    try {
      const exportClassIds = classId ? [classId]
        : (major ? classes.filter((c) => c.major_effective === major).map((c) => c.id) : [])
      const res = await api('/export/workbook', {
        method: 'POST', raw: true,
        body: { academic_year_id: yearId, grade_ids: gradeId ? [gradeId] : [], class_ids: exportClassIds, brief },
      })
      download(res, brief ? '综测简表.xlsx' : '综测汇总工作簿.xlsx')
      message.success(brief ? '简表已生成' : '完整工作簿已生成')
    } catch (e) { message.error(e.message) }
  }

  const columns = [
    { title: '综测排名', dataIndex: 'eval_rank', width: 90, sorter: (a, b) => (a.eval_rank || 9e9) - (b.eval_rank || 9e9),
      render: (v, r) => v ? <b>{v}</b> : <Tag>—</Tag> },
    { title: '智育排名', dataIndex: 'academic_rank', width: 90,
      render: (v) => v || '—' },
    { title: '班级', dataIndex: 'class_name', width: 130 },
    { title: '学号', dataIndex: 'student_no', width: 110 },
    { title: '姓名', dataIndex: 'name', width: 90 },
    { title: '学业加权平均', dataIndex: 'weighted_avg', width: 120,
      render: (v) => v?.toFixed(2) ?? '—' },
    ...(data?.scheme.items || []).map((it) => ({
      title: `${it.name}（${it.max_score}）`, width: 110,
      render: (_, r) => {
        const cell = (r.items || []).find((x) => x.name === it.name)
        if (!r.eval_entered) return <span style={{ color: '#bbb' }}>未录入</span>
        if (!cell?.entered) return <span style={{ color: '#bbb' }}>0（未录）</span>
        return cell.score
      },
    })),
    { title: '综合素质测评', dataIndex: 'eval_total', width: 115,
      render: (v, r) => r.eval_entered ? <b>{v}</b> : <span style={{ color: '#bbb' }}>0（未录入）</span> },
    { title: '综合测评成绩', dataIndex: 'final_score', width: 115,
      render: (v) => v?.toFixed(2) ?? '—' },
    { title: '特殊成绩', dataIndex: 'special_count', width: 90,
      render: (v) => v > 0 ? <Tag color="orange">{v} 条</Tag> : '—' },
    { title: '明细', width: 70, render: (_, r) => <a onClick={() => setReportOf(r)}>报告</a> },
  ]

  return (
    <PageContainer
      content="按综测排名呈现的合成成绩大表；智育/综测排名在专业内计算（同年级班级名去班号后相同的班级为一组，如 建筑类2401/2402）。点击「报告」查看单个学生成绩与综测明细。"
      extra={[
        <Select key="y" placeholder="学年" style={{ width: 140 }} value={yearId}
          options={years.map((y) => ({ value: y.id, label: y.name }))} onChange={(v) => { setYearId(v) }} />,
        <Select key="g" placeholder="年级" style={{ width: 120 }} value={gradeId}
          options={grades.map((g) => ({ value: g.id, label: g.name }))} onChange={(v) => { setGradeId(v); setClassId(null); setMajor(null) }} />,
        <Select key="m" placeholder="全部专业" style={{ width: 130 }} value={major} allowClear
          showSearch optionFilterProp="label" options={majorOptions} onChange={setMajor} />,
        <Select key="c" placeholder="全部班级" style={{ width: 150 }} value={classId} allowClear
          options={classes.map((c) => ({ value: c.id, label: c.name }))} onChange={setClassId} />,
        <Input key="k" placeholder="学号/姓名" style={{ width: 140 }} allowClear
          onPressEnter={(e) => { setKeyword(e.target.value.trim()) }} />,
        <Button key="b" icon={<DownloadOutlined />} onClick={() => doExport(true)}>简表</Button>,
        <Button key="w" type="primary" color="blue" variant="solid" icon={<DownloadOutlined />}
          onClick={() => doExport(false)}>完整工作簿</Button>,
      ]}
    >
      <ProCard>
        <Table
          rowKey="student_id" columns={columns} dataSource={data?.rows || []}
          size="middle" scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 50, showSizeChanger: false,
            showTotal: (t) => `共 ${t} 人` }}
          locale={{ emptyText: '请选择学年与年级' }}
        />
      </ProCard>
      <StudentReportDrawer student={reportOf} fixedYearId={yearId} onClose={() => setReportOf(null)} />
    </PageContainer>
  )
}
