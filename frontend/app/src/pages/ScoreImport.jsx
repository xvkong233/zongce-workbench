import { useState } from 'react'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { App as AntdApp, Alert, Button, Descriptions, Form, Select, Table, Tag, Upload } from 'antd'
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import { api, download } from '../api.js'

const EXC_COLORS = { 缺学号: 'red', 缺课程代码: 'red', 未知等级: 'orange', 缺学分: 'gold', 缺绩点: 'gold', 未知学期: 'blue', 班级归属冲突: 'purple' }

export default function ScoreImport() {
  const { message, modal } = AntdApp.useApp()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [planForm] = Form.useForm()
  const [confirming, setConfirming] = useState(false)

  const downloadTemplate = async () => {
    try {
      const res = await api('/scores/template', { raw: true })
      await download(res)
    } catch (e) { message.error(e.message) }
  }

  const doPreview = async (f) => {
    const fd = new FormData()
    fd.append('file', f)
    try {
      const pv = await api('/scores/import/preview', { method: 'POST', form: fd })
      setPreview(pv)
      planForm.setFieldsValue({
        create_years: pv.create_years.map((y) => y.name),
        create_grades: pv.create_grades.map((g) => `${g.name}|${g.enrollment_year}`),
        create_classes: pv.create_classes.map((c) => `${c.name}|${c.grade_name}`),
        conflicts: Object.fromEntries(pv.conflicts.map((c) => [c.student_no, 'system'])),
      })
    } catch (e) {
      message.error(e.message)
    }
    return false
  }

  const doConfirm = async () => {
    if (!preview) return
    const values = await planForm.validateFields()
    const plan = {
      create_years: (values.create_years || []).map((n) => ({ name: n })),
      create_grades: (values.create_grades || []).map((s) => {
        const [name, year] = s.split('|'); return { name, enrollment_year: Number(year) }
      }),
      create_classes: (values.create_classes || []).map((s) => {
        const [name, grade_name] = s.split('|'); return { name, grade_name, college_name: null }
      }),
      conflicts: Object.entries(values.conflicts || {}).map(([student_no, resolve]) => ({ student_no, resolve })),
    }
    setConfirming(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('plan', JSON.stringify(plan))
      const r = await api('/scores/import/confirm', { method: 'POST', form: fd })
      modal.success({
        title: '成绩导入成功',
        content: `新建记录 ${r.stats.records_created ?? 0} 条，覆盖 ${r.stats.records_overwritten ?? 0} 条，新建学生 ${r.stats.students_created ?? 0} 人`,
      })
      setPreview(null); setFile(null)
    } catch (e) {
      message.error(e.message)
    } finally {
      setConfirming(false)
    }
  }

  const exportExceptions = () => {
    const rows = [['sheet', '行号', '异常类型', '详情'],
      ...preview.exceptions.map((e) => [e.sheet, e.row, e.type, e.detail])]
    const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '导入异常清单.csv'
    a.click()
  }

  return (
    <PageContainer content="上传教务成绩长表，系统自动识别学年/学期、换算等级、生成预览与异常清单；可先下载样例表格核对格式。"
      extra={[
        <Button key="tpl" icon={<DownloadOutlined />} onClick={downloadTemplate}>下载样例表格</Button>,
      ]}>
      <ProCard style={{ marginBottom: 16 }}>
        <Upload.Dragger
          accept=".xls,.xlsx"
          maxCount={1}
          beforeUpload={(f) => { setFile(f); doPreview(f); return false }}
          onRemove={() => { setFile(null); setPreview(null) }}
          fileList={file ? [{ uid: 'picked', name: file.name, size: file.size, type: file.type }] : []}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽成绩文件到此处</p>
          <p className="ant-upload-hint">支持 .xls / .xlsx，文件内可含多个学期 sheet</p>
        </Upload.Dragger>
      </ProCard>

      {preview && (
        <ProCard title="导入预览" extra={
          <Button type="primary" color="blue" variant="solid" loading={confirming} onClick={doConfirm}>确认入库</Button>
        }>
          <Descriptions size="small" column={4} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="文件">{preview.filename}</Descriptions.Item>
            <Descriptions.Item label="学年">{preview.years.join('、') || '—'}</Descriptions.Item>
            <Descriptions.Item label="学生 / 课程">{preview.student_count} / {preview.course_count}</Descriptions.Item>
            <Descriptions.Item label="记录数">{preview.record_count}</Descriptions.Item>
          </Descriptions>

          {(preview.create_years.length || preview.create_grades.length || preview.create_classes.length) > 0 && (
            <Alert type="warning" showIcon style={{ marginBottom: 16 }}
              message="以下基础数据不存在，确认入库时将自动新建" />
          )}
          <Form form={planForm} layout="vertical">
            {preview.create_years.length > 0 && (
              <Form.Item name="create_years" label="新建学年">
                <Select mode="tags" open={false} tokenSeparators={[',']} style={{ width: '100%' }} />
              </Form.Item>
            )}
            {preview.create_grades.length > 0 && (
              <Form.Item name="create_grades" label="新建年级（名称|入学年）" tooltip="从班级名自动推断，可修改">
                <Select mode="tags" open={false} tokenSeparators={[',']} style={{ width: '100%' }} />
              </Form.Item>
            )}
            {preview.create_classes.length > 0 && (
              <Form.Item name="create_classes" label="新建班级（名称|所属年级）">
                <Select mode="tags" open={false} tokenSeparators={[',']} style={{ width: '100%' }} />
              </Form.Item>
            )}
            {preview.conflicts.length > 0 && (
              <Alert type="info" showIcon style={{ margin: '12px 0' }}
                message="以下学生在系统中的姓名/班级与文件不一致，请逐条裁决（默认保留系统值）" />
            )}
            <Form.Item name="conflicts" label="冲突裁决" hidden={preview.conflicts.length === 0}>
              <Table
                size="small" pagination={false}
                dataSource={preview.conflicts} rowKey="student_no"
                columns={[
                  { title: '学号', dataIndex: 'student_no', width: 110 },
                  { title: '冲突详情', dataIndex: 'detail' },
                  { title: '处理', width: 180, render: (_, r) => (
                    <Form.Item noStyle shouldUpdate>
                      {({ getFieldValue, setFieldValue }) => {
                        const val = (getFieldValue('conflicts') || {})[r.student_no] || 'system'
                        const set = (v) => setFieldValue('conflicts', { ...(getFieldValue('conflicts') || {}), [r.student_no]: v })
                        return (
                          <Select size="small" style={{ width: 150 }} value={val}
                            onChange={set}
                            options={[
                              { value: 'system', label: '保留系统值' },
                              { value: 'file', label: '采用文件值' },
                            ]} />
                        )
                      }}
                    </Form.Item>
                  ) },
                ]} />
            </Form.Item>
          </Form>

          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '16px 0 8px' }}>
            <b>异常清单（{preview.exception_count} 条，特殊成绩保留入库、不计入统计）</b>
            {preview.exceptions.length > 0 && (
              <Button size="small" icon={<DownloadOutlined />} onClick={exportExceptions}>导出 CSV</Button>
            )}
          </div>
          <Table
            size="small" rowKey={(r, i) => i}
            dataSource={preview.exceptions} pagination={{ pageSize: 8 }}
            columns={[
              { title: '类型', dataIndex: 'type', width: 130,
                render: (t) => <Tag color={EXC_COLORS[t] || 'default'}>{t}</Tag> },
              { title: '位置', width: 140, render: (_, r) => `${r.sheet} 第${r.row}行` },
              { title: '详情', dataIndex: 'detail' },
            ]}
          />
        </ProCard>
      )}
    </PageContainer>
  )
}
