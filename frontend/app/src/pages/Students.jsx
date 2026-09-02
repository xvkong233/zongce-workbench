import { useEffect, useRef, useState } from 'react'
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormSelect } from '@ant-design/pro-components'
import { App as AntdApp, Button, Popconfirm, Select, Upload } from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { api, isAdmin } from '../api.js'
import { useClasses, useYears } from './hooks.js'
import StudentReportDrawer from './StudentReportDrawer.jsx'

export default function Students() {
  const { message, modal } = AntdApp.useApp()
  const tableRef = useRef()
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [reportOf, setReportOf] = useState(null)
  const classes = useClasses(null)
  const years = useYears()
  const [yearId, setYearId] = useState(undefined)
  const [importing, setImporting] = useState(false)

  const reload = () => tableRef.current?.reload()
  useEffect(() => {
    if (yearId === undefined && years.length) setYearId(years[0].id)
  }, [years])
  useEffect(() => { reload() }, [yearId])

  const request = async (params, sort) => {
    if (!yearId) return { data: [], total: 0, success: true }
    try {
      const sortKey = Object.keys(sort || {}).find((k) => sort[k])
      const r = await api('/base/students', {
        params: {
          keyword: params.keyword, class_id: params.class_id, major: params.major,
          academic_year_id: yearId,
          sort: sortKey || 'student_no',
          order: sortKey ? (sort[sortKey] === 'descend' ? 'desc' : 'asc') : 'asc',
          page: params.current, page_size: params.pageSize,
        },
      })
      return { data: r.items, total: r.total, success: true }
    } catch (e) {
      message.error(e.message)
      return { data: [], total: 0, success: false }
    }
  }

  const majorOptions = [...new Set(classes.map((c) => c.major_effective).filter(Boolean))]
    .map((m) => ({ value: m, label: m }))

  const doImport = async (file) => {
    setImporting(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await api('/base/students/import', { method: 'POST', form: fd })
      modal.success({
        title: '学生名单导入完成',
        width: 560,
        content: (
          <div style={{ fontSize: 13 }}>
            <div>新建 {r.created_students} 人，更新 {r.updated_students} 人，新建班级 {r.created_classes.length} 个</div>
            {r.conflicts?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <b style={{ color: '#fa8c16' }}>学籍与系统不一致（已按文件值更新）{r.conflicts.length} 条：</b>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {r.conflicts.slice(0, 5).map((c) => (
                    <li key={c.student_no}>{c.student_no}：{c.change}</li>
                  ))}
                </ul>
                {r.conflicts.length > 5 && <div style={{ color: '#999' }}>…等共 {r.conflicts.length} 条</div>}
              </div>
            )}
            {r.errors.length > 0 && (
              <div style={{ marginTop: 8, color: '#999' }}>错误 {r.errors.length} 条：{r.errors.slice(0, 3).join('；')}</div>
            )}
          </div>
        ),
      })
      reload()
    } catch (e) { message.error(e.message) } finally { setImporting(false) }
    return false
  }

  const downloadTemplate = async () => {
    try {
      const res = await api('/base/students/template', { raw: true })
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = '学生名单模板.xlsx'
      a.click()
    } catch (e) { message.error(e.message) }
  }

  return (
    <PageContainer
      content="查询学生各维度数据：点「报告」查看历年总览（学业加权平均 / 绩点 / 综测 / 双排名）与分学年成绩、综测明细；支持修正学籍（降级生、班级变动），成绩仍按学号归档。"
      extra={[
        <Select key="year" style={{ width: 140 }} placeholder="选择学年" value={yearId}
          options={years.map((y) => ({ value: y.id, label: y.name }))}
          onChange={(v) => setYearId(v)} />,
        <Button key="t" icon={<DownloadOutlined />} onClick={downloadTemplate}>名单模板</Button>,
        <Upload key="i" accept=".xlsx" showUploadList={false} beforeUpload={doImport}>
          <Button type="primary" color="blue" variant="solid" icon={<UploadOutlined />} loading={importing}>
            导入学生名单
          </Button>
        </Upload>,
      ]}
    >
      <ProTable
        rowKey="id"
        actionRef={tableRef}
        request={request}
        search={{ labelWidth: 'auto' }}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: '学号', dataIndex: 'student_no', width: 110, sorter: true },
          { title: '姓名', dataIndex: 'name', width: 90, sorter: true },
          { title: '班级', dataIndex: 'class_id', valueType: 'select', width: 130,
            fieldProps: { showSearch: true, optionFilterProp: 'label',
              options: classes.map((c) => ({ value: c.id, label: `${c.name}（${c.grade_name}）` })) },
            render: (_, r) => r.class_name },
          { title: '年级', dataIndex: 'grade_name', width: 90, hideInSearch: true, sorter: true },
          { title: '专业', dataIndex: 'major', valueType: 'select', width: 120, sorter: true,
            fieldProps: { showSearch: true, optionFilterProp: 'label', options: majorOptions },
            render: (_, r) => r.major
              ? r.major_effective
              : (r.major_effective
                  ? <span style={{ color: '#888' }}>{r.major_effective}（自动）</span>
                  : '—') },
          { title: '学业加权平均', dataIndex: 'weighted_avg', width: 115, sorter: true, hideInSearch: true,
            render: (_, r) => r.weighted_avg?.toFixed(2) ?? '—' },
          { title: 'GPA', dataIndex: 'avg_gpa', width: 90, sorter: true, hideInSearch: true,
            render: (_, r) => r.avg_gpa?.toFixed(2) ?? '—' },
          { title: '综合素质测评', dataIndex: 'eval_total', width: 115, sorter: true, hideInSearch: true,
            render: (_, r) => r.eval_entered ? r.eval_total : <span style={{ color: '#bbb' }}>未录入</span> },
          { title: '综合测评成绩', dataIndex: 'final_score', width: 115, sorter: true, hideInSearch: true,
            render: (_, r) => r.final_score?.toFixed(2) ?? '—' },
          {
            title: '操作', valueType: 'option', width: 200, fixed: 'right',
            render: (_, r) => [
              <a key="report" onClick={() => setReportOf({ student_id: r.id, student_no: r.student_no,
                                             name: r.name, class_name: r.class_name })}>报告</a>,
              <a key="edit" onClick={() => setEditing(r)}>修正学籍</a>,
              isAdmin() && (
                <Popconfirm key="del" title="删除该学生？将级联删除其成绩与综测记录"
                  onConfirm={async () => {
                    try { await api(`/base/students/${r.id}`, { method: 'DELETE' }); message.success('已删除'); reload() }
                    catch (e) { message.error(e.message) }
                  }}>
                  <a style={{ color: 'red' }}>删除</a>
                </Popconfirm>
              ),
            ],
          },
        ]}
      />
      <StudentEditModal open={editOpen || !!editing} editing={editing} classes={classes}
        onClose={() => setEditing(null)} onDone={reload} />
      <StudentReportDrawer student={reportOf} onClose={() => setReportOf(null)} />
    </PageContainer>
  )
}

function StudentEditModal({ open, editing, classes, onClose, onDone }) {
  const { message } = AntdApp.useApp()
  return (
    <ModalForm
      title={editing ? `修正学籍：${editing.name}` : '修正学籍'}
      open={open && !!editing}
      modalProps={{ destroyOnHidden: true, onCancel: onClose }}
      initialValues={editing ? { student_no: editing.student_no, name: editing.name, class_id: editing.class_id } : {}}
      onFinish={async (v) => {
        try {
          await api(`/base/students/${editing.id}`, { method: 'PUT', body: v })
          message.success('已保存')
          onDone(); onClose()
          return true
        } catch (e) { message.error(e.message); return false }
      }}
    >
      <ProFormText name="student_no" label="学号" rules={[{ required: true }]} />
      <ProFormText name="name" label="姓名" rules={[{ required: true }]} />
      <ProFormSelect name="class_id" label="班级" showSearch optionFilterProp="label"
        options={classes.map((c) => ({ value: c.id, label: `${c.name}（${c.grade_name}）` }))}
        rules={[{ required: true }]} />
    </ModalForm>
  )
}
