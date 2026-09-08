import { useRef, useState } from 'react'
import { ProCard } from '@ant-design/pro-components'
import {
  Alert, App as AntdApp, Button, Card, Descriptions, Space, Table, Tag, Tooltip,
  Typography, Upload,
} from 'antd'
import { FilePdfOutlined, InboxOutlined } from '@ant-design/icons'
import { api } from '../api.js'

const STATUS = {
  new: { color: 'green', text: '新增' },
  overwrite: { color: 'blue', text: '覆盖' },
  error: { color: 'red', text: '跳过' },
}

function scoreCell(r) {
  const converted = r.score_num !== null && String(r.score_num) !== r.score_raw
  return (
    <Space size={4}>
      <span>{r.score_raw || '—'}</span>
      {converted && <span style={{ color: '#999' }}>（{r.score_num}）</span>}
      {r.status === 'overwrite' && (
        <Tag color="orange" style={{ marginInlineEnd: 0 }}>原 {r.existing_score_raw || '空'}</Tag>
      )}
      {r.retake_type && <Tag color="purple" style={{ marginInlineEnd: 0 }}>重修</Tag>}
    </Space>
  )
}

function TranscriptFileCard({ file, selected, onChange }) {
  const rowKeys = file.rows.filter((r) => r.status !== 'error').map((r) => r.seq)
  const checkedCount = rowKeys.filter((k) => selected.has(k)).length
  return (
    <Card
      size="small" style={{ marginBottom: 16 }}
      title={<Space><FilePdfOutlined />{file.filename}</Space>}
      extra={
        <Space>
          <Button size="small" disabled={checkedCount === rowKeys.length}
            onClick={() => onChange(new Set(rowKeys))}>全选</Button>
          <Button size="small" disabled={checkedCount === 0}
            onClick={() => onChange(new Set())}>清空</Button>
        </Space>
      }
    >
      {file.error ? (
        <Alert type="error" showIcon message={file.error} />
      ) : (
        <>
          <Descriptions size="small" column={4} style={{ marginBottom: 8 }}>
            <Descriptions.Item label="学生">{file.name}（{file.student_no}）</Descriptions.Item>
            <Descriptions.Item label="班级">{file.class_name || '—'}</Descriptions.Item>
            <Descriptions.Item label="专业 / 学院">{file.major || '—'} / {file.college || '—'}</Descriptions.Item>
            <Descriptions.Item label="成绩单绩点">
              {file.gpa_total ?? '—'}
            </Descriptions.Item>
          </Descriptions>
          {file.exceptions.length > 0 && (
            <Alert type="warning" showIcon style={{ marginBottom: 8 }}
              message={file.exceptions.map((e, i) => (
                <div key={i}>{e.type}：{e.detail}</div>
              ))} />
          )}
          <Table
            size="small"
            rowKey="seq"
            dataSource={file.rows}
            pagination={file.rows.length > 10 ? { pageSize: 10 } : false}
            rowSelection={{
              selectedRowKeys: rowKeys.filter((k) => selected.has(k)),
              onChange: (keys) => onChange(new Set(keys)),
              getCheckboxProps: (r) => ({ disabled: r.status === 'error' }),
            }}
            columns={[
              { title: '序号', dataIndex: 'seq', width: 55 },
              {
                title: '课程名称', dataIndex: 'course_name',
                render: (v, r) => (
                  <Space size={4}>
                    <span>{v}</span>
                    {r.exception && (
                      <Tooltip title={r.exception}>
                        <Typography.Text type="warning" style={{ fontSize: 12 }}>⚠</Typography.Text>
                      </Tooltip>
                    )}
                  </Space>
                ),
              },
              { title: '学年学期', width: 170,
                render: (_, r) => `${r.year} ${r.semester}` },
              { title: '学分', dataIndex: 'credit', width: 70 },
              { title: '成绩', width: 190, render: (_, r) => scoreCell(r) },
              { title: '类别', dataIndex: 'course_category', width: 70 },
              { title: '状态', width: 70,
                render: (_, r) => {
                  const s = STATUS[r.status] || STATUS.error
                  return <Tag color={s.color}>{s.text}</Tag>
                } },
            ]}
          />
        </>
      )}
    </Card>
  )
}

export default function TranscriptImport() {
  const { message, modal } = AntdApp.useApp()
  const [files, setFiles] = useState([])
  const filesRef = useRef([])   // beforeUpload 每批只带本批 fileList，需与已选合并去重
  const [preview, setPreview] = useState(null)
  // {文件下标: Set(选中的行序号)}；null 表示全选
  const [selection, setSelection] = useState(null)
  const [confirming, setConfirming] = useState(false)

  const doPreview = async (list) => {
    if (!list.length) { setPreview(null); setSelection(null); return }
    const fd = new FormData()
    for (const f of list) fd.append('files', f)
    try {
      const pv = await api('/scores/transcript/preview', { method: 'POST', form: fd })
      setPreview(pv)
      setSelection(null)
    } catch (e) {
      message.error(e.message)
    }
  }

  const addFiles = (fileList) => {
    const map = new Map(filesRef.current.map((f) => [f.uid, f]))
    for (const f of fileList) map.set(f.uid, f)
    const merged = [...map.values()]
    filesRef.current = merged
    setFiles(merged)
    doPreview(merged)
  }

  const onRemove = (f) => {
    const rest = filesRef.current.filter((x) => x.uid !== f.uid)
    filesRef.current = rest
    setFiles(rest)
    doPreview(rest)
  }

  const reset = () => {
    filesRef.current = []
    setPreview(null); setFiles([]); setSelection(null)
  }

  const selFor = (idx, file) => {
    if (!selection || !selection[idx]) {
      return new Set(file.rows.filter((r) => r.status !== 'error').map((r) => r.seq))
    }
    return selection[idx]
  }

  const selectedCount = () => {
    if (!preview) return 0
    return preview.files.reduce((n, f, idx) => f.error ? n : n + selFor(idx, f).size, 0)
  }

  const doConfirm = async () => {
    if (!preview || selectedCount() === 0) return
    const include = {}
    preview.files.forEach((f, idx) => {
      if (!f.error) include[idx] = [...selFor(idx, f)].sort((a, b) => a - b)
    })
    setConfirming(true)
    try {
      const fd = new FormData()
      for (const f of files) fd.append('files', f)
      fd.append('plan', JSON.stringify({ include }))
      const r = await api('/scores/transcript/confirm', { method: 'POST', form: fd })
      modal.success({
        title: '成绩单补录成功',
        content: `新建记录 ${r.stats.records_created ?? 0} 条，覆盖 ${r.stats.records_overwritten ?? 0} 条。` +
          '可在「日志与批次」中整批回滚。',
      })
      reset()
    } catch (e) {
      message.error(e.message)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <>
      <ProCard style={{ marginBottom: 16 }}>
        <Upload.Dragger
          accept=".pdf"
          multiple
          fileList={files}
          beforeUpload={(_, fileList) => {
            addFiles(fileList)
            return false
          }}
          onRemove={onRemove}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽成绩单 PDF 到此处（可多份）</p>
          <p className="ant-upload-hint">
            支持教务处导出的学生成绩单 PDF；按「学号 + 学年 + 学期 + 课程名」与已有成绩匹配，
            已有记录为覆盖更正，缺失记录为补录新增，入库后可整批回滚
          </p>
        </Upload.Dragger>
      </ProCard>

      {preview && (
        <ProCard
          title="补录预览"
          extra={
            <Button type="primary" color="blue" variant="solid" loading={confirming}
              disabled={selectedCount() === 0}
              onClick={doConfirm}>
              补录所选（{selectedCount()} 条）
            </Button>
          }
        >
          {(preview.student_count > 0 || preview.row_count > 0) && (
            <Descriptions size="small" column={4} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="学生">{preview.student_count} 人</Descriptions.Item>
              <Descriptions.Item label="课程记录">{preview.row_count} 条</Descriptions.Item>
              <Descriptions.Item label="新增 / 覆盖">
                <Typography.Text type="success">{preview.new_count}</Typography.Text>
                {' / '}
                <Typography.Text type="secondary">{preview.overwrite_count}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="待关注">
                {preview.exception_count > 0
                  ? <Typography.Text type="warning">{preview.exception_count} 条</Typography.Text>
                  : '无'}
              </Descriptions.Item>
            </Descriptions>
          )}
          {preview.files.map((f, idx) => (
            <TranscriptFileCard key={`${f.file_index}-${f.filename}`}
              file={f}
              selected={selFor(idx, f)}
              onChange={(s) => setSelection({ ...selection, [idx]: s })} />
          ))}
        </ProCard>
      )}
    </>
  )
}
