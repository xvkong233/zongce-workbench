import { useEffect, useState } from 'react'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { App as AntdApp, Alert, Button, Descriptions, Select, Space, Table, Tag, Upload } from 'antd'
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import { api, download } from '../api.js'
import { useGrades, useYears } from './hooks.js'

export default function EvalImport() {
  const { message, modal } = AntdApp.useApp()
  const years = useYears()
  const grades = useGrades()
  const [yearId, setYearId] = useState(undefined)
  const [gradeId, setGradeId] = useState(undefined)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [confirming, setConfirming] = useState(false)

  const downloadTemplate = async () => {
    try {
      const res = await api('/evals/template', { raw: true })
      await download(res)
    } catch (e) { message.error(e.message) }
  }

  useEffect(() => {
    if (yearId === undefined && years.length) setYearId(years[0].id)
  }, [years])

  const gradeName = grades.find((g) => g.id === gradeId)?.name || ''
  const yearName = years.find((y) => y.id === yearId)?.name || ''
  const ready = !!(yearId && gradeId)

  const doPreview = async (f, y, g) => {
    if (!f || !y || !g) return
    const fd = new FormData()
    fd.append('file', f)
    try {
      const r = await api('/evals/import/preview', {
        method: 'POST', form: fd, params: { academic_year_id: y, grade_id: g },
      })
      setPreview(r)
    } catch (e) {
      message.error(e.message)
      setPreview(null)
    }
    return false
  }

  const reset = () => { setFile(null); setPreview(null) }

  const doConfirm = async () => {
    if (!preview) return
    setConfirming(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('academic_year_id', String(yearId))
      fd.append('grade_id', String(gradeId))
      fd.append('resolve', JSON.stringify({}))
      const r = await api('/evals/import/confirm', { method: 'POST', form: fd })
      modal.success({
        title: '综测导入成功',
        content: `更新 ${r.stats.students_updated} 人，新建 ${r.stats.records_created} 条，`
          + `覆盖 ${r.stats.records_overwritten} 条，未匹配 ${r.stats.unmatched} 人，`
          + `明细不符 ${r.stats.soft_mismatch} 条`,
      })
      reset()
    } catch (e) {
      message.error(e.message)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <PageContainer content="上传班级综测明细表（自动识别双层表头与合并单元格），选择目标学年与年级后按学号自动匹配入库，无需班级映射；可先下载样例表格核对格式。"
      extra={[
        <Button key="tpl" icon={<DownloadOutlined />} onClick={downloadTemplate}>下载样例表格</Button>,
      ]}>
      <ProCard style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <Select placeholder="目标学年" style={{ width: 160 }} value={yearId}
              options={years.map((y) => ({ value: y.id, label: y.name }))}
              onChange={(v) => { setYearId(v); if (file && gradeId) doPreview(file, v, gradeId) }} />
            <Select placeholder="目标年级" style={{ width: 160 }} value={gradeId}
              showSearch optionFilterProp="label"
              options={grades.map((g) => ({ value: g.id, label: g.name }))}
              onChange={(v) => { setGradeId(v); if (file && yearId) doPreview(file, yearId, v) }} />
            <span style={{ color: '#999', fontSize: 12 }}>导入范围：仅匹配所选年级内学生的学号</span>
          </Space>
          <Upload.Dragger
            accept=".xlsx"
            maxCount={1}
            disabled={!ready}
            fileList={file ? [file] : []}
            beforeUpload={(f) => { setFile(f); doPreview(f, yearId, gradeId); return false }}
            onRemove={reset}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽综测明细文件到此处</p>
            <p className="ant-upload-hint">
              {ready ? '支持 .xlsx，覆盖该批学生同年学年的旧记录' : '请先选择目标学年与年级'}
            </p>
          </Upload.Dragger>
        </Space>
      </ProCard>

      {preview && (
        <ProCard title="导入预览" extra={
          <Button type="primary" color="blue" variant="solid" loading={confirming}
            disabled={preview.matched_count === 0} onClick={doConfirm}>确认入库</Button>
        }>
          <Descriptions size="small" column={4} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="文件">{preview.filename}</Descriptions.Item>
            <Descriptions.Item label="范围">{preview.year} · {preview.grade}</Descriptions.Item>
            <Descriptions.Item label="文件学生数">{preview.student_count}</Descriptions.Item>
            <Descriptions.Item label="匹配成功">
              {preview.matched_count === preview.student_count
                ? <Tag color="green">{preview.matched_count} 人</Tag>
                : <Tag color="orange">{preview.matched_count} / {preview.student_count} 人</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="项目" span={2}>
              {preview.item_names.map((n) => (
                <Tag key={n}>{n}{preview.item_maxes[n] ? ` ${preview.item_maxes[n]}` : ''}</Tag>
              ))}
            </Descriptions.Item>
            <Descriptions.Item label="明细不符" span={2}>
              {preview.soft_mismatch > 0
                ? <Tag color="orange">{preview.soft_mismatch} 条明细求和与得分不一致</Tag>
                : <Tag color="green">全部一致</Tag>}
            </Descriptions.Item>
          </Descriptions>

          {preview.class_keys.length > 0 && (
            <p style={{ color: '#999', fontSize: 12 }}>
              文件班级列（仅作参考，不影响匹配）：{preview.class_keys.join('、')}
            </p>
          )}

          {preview.unmatched_count > 0 && (
            <>
              <Alert type="warning" showIcon style={{ margin: '12px 0' }}
                message={`未匹配 ${preview.unmatched_count} 人（学号不在 ${gradeName || '所选年级'} 内或不存在，均不入库）`} />
              <Table
                size="small" rowKey={(r, i) => i}
                dataSource={preview.unmatched} pagination={{ pageSize: 8 }}
                style={{ marginBottom: 8 }}
                columns={[
                  { title: '学号', dataIndex: 'student_no', width: 140 },
                  { title: '姓名', dataIndex: 'name', width: 120 },
                  { title: '文件班级', dataIndex: 'class' },
                ]} />
            </>
          )}
        </ProCard>
      )}
    </PageContainer>
  )
}
