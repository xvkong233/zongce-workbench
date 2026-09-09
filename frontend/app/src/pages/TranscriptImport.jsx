import { useEffect, useRef, useState } from 'react'
import { ProCard } from '@ant-design/pro-components'
import {
  Alert, App as AntdApp, Button, Card, Descriptions, Select, Space, Table, Tag, Tooltip,
  Typography, Upload,
} from 'antd'
import { FilePdfOutlined, InboxOutlined } from '@ant-design/icons'
import { api } from '../api.js'

const STATUS = {
  new: { color: 'green', text: '新增' },
  overwrite: { color: 'blue', text: '覆盖' },
  error: { color: 'red', text: '跳过' },
}

const NEW_CLASS = '__new__'   // 不选已有班级：按成绩单信息新建班级建档

const classOption = (c) => ({
  value: c.id,
  label: `${c.name}（${c.grade_name}${c.college_name ? ` · ${c.college_name}` : ''}）`,
})

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

function TranscriptFileCard({ file, fileIndex, selected, onChange, classes, pick, onPick }) {
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
          {file.create_student && (
            <Alert type="warning" showIcon style={{ marginBottom: 8 }}
              message={
                <Space wrap size={8}>
                  <span>该学号不在系统中，确认入库后将自动创建学生，请选择其班级：</span>
                  <Select
                    size="small" style={{ minWidth: 240 }} showSearch
                    optionFilterProp="label" value={pick}
                    onChange={(v) => onPick(fileIndex, v)}
                    options={[
                      ...classes.map(classOption),
                      { value: NEW_CLASS, label: `按成绩单新建班级「${file.class_name}」` },
                    ]}
                  />
                </Space>
              } />
          )}
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
  const [classes, setClasses] = useState([])     // 自动建档时可选的已有班级（按角色过滤）
  // {文件下标: 班级 id | NEW_CLASS}；未设置时默认「同名已有班级，否则按成绩单新建」
  const [classPicks, setClassPicks] = useState({})
  const [batchClassId, setBatchClassId] = useState(undefined)   // 批量设置班级

  // 预览中存在待建档学生时才拉取班级列表
  useEffect(() => {
    if (preview?.create_student_count > 0 && classes.length === 0) {
      api('/base/classes').then(setClasses).catch(() => {})
    }
  }, [preview])  // eslint-disable-line react-hooks/exhaustive-deps

  const pickOf = (f, idx) => {
    if (classPicks[idx] !== undefined) return classPicks[idx]
    const same = classes.find((c) => c.name === f.class_name)
    return same ? same.id : NEW_CLASS
  }

  // 本批待建档（学号不在系统且解析无错）的文件，可对其批量设置班级
  const createFiles = preview
    ? preview.files.map((f, idx) => ({ f, idx })).filter(({ f }) => !f.error && f.create_student)
    : []

  const applyBatchClass = () => {
    if (!batchClassId || createFiles.length === 0) return
    const picks = { ...classPicks }
    for (const { idx } of createFiles) picks[idx] = batchClassId
    setClassPicks(picks)
    message.success(`已将 ${createFiles.length} 份待建档文件的目标班级统一设置`)
  }

  const doPreview = async (list) => {
    if (!list.length) { setPreview(null); setSelection(null); return }
    const fd = new FormData()
    for (const f of list) fd.append('files', f)
    try {
      const pv = await api('/scores/transcript/preview', { method: 'POST', form: fd })
      setPreview(pv)
      setSelection(null)
      setClassPicks({})
      setBatchClassId(undefined)
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
    setPreview(null); setFiles([]); setSelection(null); setClassPicks({})
    setBatchClassId(undefined)
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
    const class_overrides = {}
    preview.files.forEach((f, idx) => {
      if (!f.error) include[idx] = [...selFor(idx, f)].sort((a, b) => a - b)
      if (!f.error && f.create_student && pickOf(f, idx) !== NEW_CLASS) {
        class_overrides[idx] = pickOf(f, idx)   // 指定已有班级建档
      }
    })
    setConfirming(true)
    try {
      const fd = new FormData()
      for (const f of files) fd.append('files', f)
      fd.append('plan', JSON.stringify({ include, class_overrides }))
      const r = await api('/scores/transcript/confirm', { method: 'POST', form: fd })
      const s = r.stats || {}
      modal.success({
        title: '成绩单补录成功',
        content: `新建记录 ${s.records_created ?? 0} 条，覆盖 ${s.records_overwritten ?? 0} 条` +
          (s.students_created ? `，自动创建学生 ${s.students_created} 人` : '') +
          '。可在「日志与批次」中整批回滚。',
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
          accept=".pdf,.zip,.rar,.7z"
          multiple
          fileList={files}
          beforeUpload={(_, fileList) => {
            addFiles(fileList)
            return false
          }}
          onRemove={onRemove}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽成绩单 PDF / 压缩包到此处（可多份）</p>
          <p className="ant-upload-hint">
            支持教务处导出的学生成绩单 PDF 及 zip / rar / 7z 压缩包（自动解包，zip 中文文件名兼容）；
            按「学号 + 学年 + 学期 + 课程名」与已有成绩匹配，已有记录为覆盖更正，缺失记录为补录新增；
            学号不在系统时自动建档，可单个或批量指定已有班级、也可按成绩单新建，入库后可整批回滚
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
            <Descriptions size="small" column={5} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="学生">{preview.student_count} 人</Descriptions.Item>
              <Descriptions.Item label="课程记录">{preview.row_count} 条</Descriptions.Item>
              <Descriptions.Item label="新增 / 覆盖">
                <Typography.Text type="success">{preview.new_count}</Typography.Text>
                {' / '}
                <Typography.Text type="secondary">{preview.overwrite_count}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="自动建档">
                {preview.create_student_count > 0
                  ? <Typography.Text type="warning">{preview.create_student_count} 人</Typography.Text>
                  : '无'}
              </Descriptions.Item>
              <Descriptions.Item label="待关注">
                {preview.exception_count > 0
                  ? <Typography.Text type="warning">{preview.exception_count} 条</Typography.Text>
                  : '无'}
              </Descriptions.Item>
            </Descriptions>
          )}
          {createFiles.length > 0 && (
            <Space wrap style={{ marginBottom: 16 }}>
              <Typography.Text>批量设置待建档学生的班级：</Typography.Text>
              <Select style={{ minWidth: 240 }} showSearch optionFilterProp="label"
                placeholder="选择班级" value={batchClassId}
                onChange={setBatchClassId}
                options={classes.map(classOption)} />
              <Button disabled={!batchClassId} onClick={applyBatchClass}>
                应用到全部待建档文件（{createFiles.length} 份）
              </Button>
            </Space>
          )}
          {preview.files.map((f, idx) => (
            <TranscriptFileCard key={`${f.file_index}-${f.filename}`}
              file={f}
              fileIndex={idx}
              selected={selFor(idx, f)}
              onChange={(s) => setSelection({ ...selection, [idx]: s })}
              classes={classes}
              pick={pickOf(f, idx)}
              onPick={(i, v) => setClassPicks({ ...classPicks, [i]: v })} />
          ))}
        </ProCard>
      )}
    </>
  )
}
