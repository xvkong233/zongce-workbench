import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageContainer, ProCard, ModalForm, ProFormSelect } from '@ant-design/pro-components'
import { App as AntdApp, Alert, Button, Input, InputNumber,
         Popconfirm, Select, Space, Table, Tag } from 'antd'
import { CopyOutlined, RollbackOutlined, ThunderboltOutlined, UploadOutlined } from '@ant-design/icons'
import { api } from '../api.js'
import { useClasses, useGrades, useYears } from './hooks.js'

const fmt = (v) => (v === null || v === undefined ? '' : v)

export default function EvalEntry() {
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const years = useYears()
  const grades = useGrades()
  const [yearId, setYearId] = useState(null)
  const classes = useClasses(null)
  const [classId, setClassId] = useState(null)
  const [roster, setRoster] = useState(null) // {items, rows, weight_academic, weight_eval}
  const [saving, setSaving] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)

  const loadRoster = async (y = yearId, c = classId) => {
    if (!y || !c) return
    try {
      const r = await api('/evals/roster', { params: { academic_year_id: y, class_id: c } })
      setRoster({
        ...r,
        rows: r.rows.map((row) => ({
          ...row,
          cells: row.items.map((it) => ({ detail_text: it.detail_text || '', score: it.score ?? null })),
        })),
      })
    } catch (e) { message.error(e.message) }
  }
  useEffect(() => { loadRoster() }, [yearId, classId])

  const setCell = (rowIdx, itemIdx, field, value) => {
    setRoster((prev) => {
      const rows = [...prev.rows]
      const cells = [...rows[rowIdx].cells]
      cells[itemIdx] = { ...cells[itemIdx], [field]: value }
      rows[rowIdx] = { ...rows[rowIdx], cells }
      return { ...prev, rows }
    })
  }

  const itemSubtotal = (row, itemIdx, max) => {
    const v = row.cells?.[itemIdx]?.score
    return v === null || v === undefined ? null : Math.min(v, max)
  }
  const rowTotal = (row) => {
    if (!row.cells) return null
    if (!row.items.some((_, i) => row.cells[i] && (row.cells[i].score !== null && row.cells[i].score !== undefined))) return null
    const total = row.items.reduce((acc, it, i) => acc + (itemSubtotal(row, i, roster.items[i]?.max_score) ?? 0), 0)
    return Math.round(total * 10) / 10
  }

  const saveRow = async (row) => {
    try {
      const body = {
        student_id: row.student_id, academic_year_id: yearId,
        items: row.items.map((it, i) => ({
          item_name: it.name,
          detail_text: row.cells[i]?.detail_text || '',
          score: row.cells[i]?.score || 0,
        })),
      }
      const r = await api('/evals/save', { method: 'PUT', body })
      if (r.mismatches?.length) {
        message.warning(`已保存，但以下项目明细求和与得分不一致：${r.mismatches.join('、')}`)
      } else message.success(`已保存 ${row.name}`)
      loadRoster()
    } catch (e) { message.error(e.message) }
  }

  const batchSave = async () => {
    setSaving(true)
    try {
      const rows = roster.rows.map((row) => ({
        student_id: row.student_id,
        items: row.items.map((it, i) => ({
          item_name: it.name,
          detail_text: row.cells[i]?.detail_text || '',
          score: row.cells[i]?.score || 0,
        })),
      }))
      await api('/evals/batch', { method: 'POST', body: { academic_year_id: yearId, rows } })
      message.success('全班已保存')
      loadRoster()
    } catch (e) { message.error(e.message) } finally { setSaving(false) }
  }

  const fillBase = async () => {
    try {
      const r = await api('/evals/fill-base', {
        method: 'POST', body: { academic_year_id: yearId, class_id: classId, only_missing: true },
      })
      message.success(`基础分已填充：${r.filled_records} 条（影响 ${r.students_affected} 名未录入学生）`)
      loadRoster()
    } catch (e) { message.error(e.message) }
  }

  const columns = useMemo(() => {
    if (!roster) return []
    const cols = [
      { title: '学号', dataIndex: 'student_no', width: 100, fixed: 'left' },
      { title: '姓名', dataIndex: 'name', width: 90, fixed: 'left' },
    ]
    roster.items.forEach((it, itemIdx) => {
      cols.push({
        title: <div>{it.name} <Tag style={{ marginInlineEnd: 0 }}>满分 {it.max_score}</Tag></div>,
        width: 260,
        render: (_, row) => {
          const cell = row.cells[itemIdx] || {}
          const src = row.items[itemIdx] || {}
          return (
            <div>
              <Input.TextArea
                value={cell.detail_text} autoSize={{ minRows: 1, maxRows: 6 }}
                onChange={(e) => setCell(rowIdxOf(row), itemIdx, 'detail_text', e.target.value)}
                placeholder="加减分明细" style={{ marginBottom: 4, fontSize: 12 }} />
              <Space>
                <InputNumber size="small" value={cell.score} step={0.5}
                  onChange={(v) => setCell(rowIdxOf(row), itemIdx, 'score', v)} />
                {src.mismatch && <Tag color="orange">明细不符</Tag>}
                {src.soft_sum !== null && src.soft_sum !== undefined && !src.mismatch && cell.detail_text && (
                  <span style={{ color: '#999', fontSize: 12 }}>明细和 {src.soft_sum}</span>
                )}
              </Space>
            </div>
          )
        },
      })
    })
    cols.push({
      title: <>综素合计<small>（封顶后）</small></>, width: 100, fixed: 'right',
      render: (_, row) => <b>{rowTotal(row) ?? '—'}</b>,
    })
    cols.push({
      title: '操作', width: 80, fixed: 'right',
      render: (_, row) => <a onClick={() => saveRow(row)}>保存</a>,
    })
    return cols

    function rowIdxOf(row) { return roster.rows.findIndex((r) => r.student_id === row.student_id) }
  }, [roster])

  return (
    <PageContainer
      content="选学年与班级后逐人录入五个项目的加减分明细与得分；各项小计按满分封顶。"
      extra={[
        <Select key="y" placeholder="学年" style={{ width: 140 }} value={yearId}
          options={years.map((y) => ({ value: y.id, label: y.name }))} onChange={setYearId} />,
        <Select key="c" placeholder="班级" style={{ width: 170 }} value={classId} showSearch optionFilterProp="label"
          options={classes.map((c) => ({ value: c.id, label: `${c.name}（${c.grade_name}）` }))}
          onChange={setClassId} />,
      ]}
    >
      {roster && (
        <div style={{ marginBottom: 12 }}>
          <Space wrap>
            <Button icon={<ThunderboltOutlined />} onClick={fillBase}>批量填充基础分（仅未录入学生）</Button>
            <Button icon={<CopyOutlined />} onClick={() => setCopyOpen(true)}>复制上一学年</Button>
            <Button icon={<UploadOutlined />} onClick={() => navigate('/eval-import')}>导入综测明细</Button>
            <Popconfirm title="确认保存全班所有学生的录入内容？" onConfirm={batchSave}>
              <Button type="primary" color="blue" variant="solid" loading={saving}>保存全班</Button>
            </Popconfirm>
            <span style={{ color: '#999' }}>
              权重：学业 {roster.weight_academic} / 综素 {roster.weight_eval}；
              已录入 {roster.rows.filter((r) => r.entered).length}/{roster.rows.length} 人
            </span>
          </Space>
        </div>
      )}
      <ProCard>
        {roster ? (
          <Table
            rowKey="student_id" columns={columns} dataSource={roster.rows}
            size="small" scroll={{ x: 'max-content' }}
            pagination={false} bordered
          />
        ) : <Alert type="info" showIcon message="请选择学年与班级" />}
      </ProCard>

      <CopyPrevModal open={copyOpen} onClose={() => setCopyOpen(false)} years={years}
        yearId={yearId} classId={classId} onDone={() => loadRoster()} />
    </PageContainer>
  )
}

function CopyPrevModal({ open, onClose, years, yearId, classId, onDone }) {
  const { message } = AntdApp.useApp()
  return (
    <ModalForm title="复制上一学年综测（仅填充未录入学生）"
      open={open} onClose={undefined} modalProps={{ destroyOnHidden: true, onCancel: onClose }}
      onFinish={async (v) => {
        try {
          const r = await api('/evals/copy-prev', {
            method: 'POST',
            body: { from_year_id: v.from_year_id, to_year_id: yearId, class_id: classId },
          })
          message.success(`已复制 ${r.copied_records} 条；跳过已录入学生 ${r.skipped_students} 人，无法映射项目 ${r.skipped_items} 条`)
          onDone(); onClose()
          return true
        } catch (e) { message.error(e.message); return false }
      }}>
      <ProFormSelect name="from_year_id" label="来源学年" placeholder="选择上一学年"
        options={years.map((y) => ({ value: y.id, label: y.name }))}
        rules={[{ required: true, message: '请选择来源学年' }]} />
    </ModalForm>
  )
}

