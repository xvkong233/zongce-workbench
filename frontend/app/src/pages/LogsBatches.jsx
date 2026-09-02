import { useRef, useState } from 'react'
import { PageContainer, ProCard, ProTable } from '@ant-design/pro-components'
import { App as AntdApp, Button, Modal, Popconfirm, Select, Space, Statistic, Tabs, Tag } from 'antd'
import { ClearOutlined } from '@ant-design/icons'
import { api } from '../api.js'
import { useGrades, useYears } from './hooks.js'

export default function LogsBatches() {
  return (
    <PageContainer>
      <ProCard>
        <Tabs items={[
          { key: 'logs', label: '操作日志', children: <LogsTab /> },
          { key: 'batches', label: '导入批次', children: <BatchesTab /> },
          { key: 'clear', label: '数据清理', children: <ClearDataTab /> },
        ]} />
      </ProCard>
    </PageContainer>
  )
}

const ACTION_COLORS = { 成绩导入: 'blue', 综测导入: 'cyan', 批次撤销: 'orange', 删除学生: 'red', 修改密码: 'purple' }

function LogsTab() {
  const { message } = AntdApp.useApp()
  const request = async (params) => {
    try {
      const r = await api('/logs', {
        params: {
          operator: params.operator_name, action: params.action,
          start: params.start_date?.[0], end: params.start_date?.[1],
          page: params.current, page_size: params.pageSize,
        },
      })
      return { data: r.items, total: r.total, success: true }
    } catch (e) { message.error(e.message); return { data: [], total: 0, success: false } }
  }
  return (
    <ProTable rowKey="id" request={request} search={{ labelWidth: 'auto' }}
      columns={[
        { title: '时间', dataIndex: 'created_at', width: 170, hideInSearch: true },
        { title: '操作人', dataIndex: 'operator_name', width: 110 },
        { title: '类型', dataIndex: 'action', width: 130,
          render: (v) => <Tag color={ACTION_COLORS[v] || 'default'}>{v}</Tag> },
        { title: '详情', dataIndex: 'detail' },
      ]}
      pagination={{ pageSize: 20, showSizeChanger: false }} />
  )
}

function BatchesTab() {
  const { message, modal } = AntdApp.useApp()
  const tableRef = useRef()
  const request = async (params) => {
    try {
      const r = await api('/batches', {
        params: { kind: params.kind, page: params.current, page_size: params.pageSize },
      })
      return { data: r.items, total: r.total, success: true }
    } catch (e) { message.error(e.message); return { data: [], total: 0, success: false } }
  }
  const revert = async (r) => {
    try {
      const res = await api(`/batches/${r.id}/revert`, { method: 'POST' })
      modal.success({ title: `批次 #${r.id} 已撤销`, content: `恢复旧值 ${res.restored} 条，删除新插入记录 ${res.deleted} 条` })
      tableRef.current.reload()
    } catch (e) { message.error(e.message) }
  }
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Space>
          <Popconfirm title="清理 90 天前的批次快照？不影响已入库的业务数据">
            <Button onClick={async () => {
              try {
                const r = await api('/batches/cleanup?days=90', { method: 'POST' })
                message.success(`已清理 ${r.cleaned_snapshots} 个批次的快照`)
                tableRef.current.reload()
              } catch (e) { message.error(e.message) }
            }}>清理 90 天前快照</Button>
          </Popconfirm>
          <span style={{ color: '#999', fontSize: 12 }}>撤销批次将恢复被覆盖的旧值并删除该批新插入记录</span>
        </Space>
      </div>
      <ProTable rowKey="id" actionRef={tableRef} request={request} search={false}
        columns={[
          { title: '批次', dataIndex: 'id', width: 70 },
          { title: '类型', dataIndex: 'kind', width: 90, render: (v) => ({ score: '成绩', eval: '综测', student: '名单' }[v] || v) },
          { title: '文件', dataIndex: 'filename' },
          { title: '学年', dataIndex: 'year', width: 110 },
          { title: '时间', dataIndex: 'created_at', width: 170 },
          { title: '统计', dataIndex: 'stats', render: (s) => (
            <span style={{ fontSize: 12 }}>{Object.entries(s || {}).map(([k, v]) => `${k}:${v}`).join('  ')}</span>) },
          { title: '状态', dataIndex: 'reverted', width: 90,
            render: (v) => v ? <Tag color="red">已撤销</Tag> : <Tag color="green">有效</Tag> },
          { title: '操作', width: 100, render: (_, r) => !r.reverted && (
            <Popconfirm title={`确认撤销批次 #${r.id}？`} onConfirm={() => revert(r)}>
              <a style={{ color: 'orange' }}>整批撤销</a>
            </Popconfirm>) },
        ]}
        pagination={{ pageSize: 20, showSizeChanger: false }} />
    </>
  )
}

function ClearDataTab() {
  const { message, modal } = AntdApp.useApp()
  const years = useYears()
  const grades = useGrades()
  const [yearId, setYearId] = useState(undefined)
  const [gradeId, setGradeId] = useState(undefined)
  const [kind, setKind] = useState('score')
  const [result, setResult] = useState(null)

  const doClear = () => {
    const kindLabel = kind === 'score' ? '成绩' : '综测'
    const yearName = years.find((y) => y.id === yearId)?.name || ''
    const gradeName = grades.find((g) => g.id === gradeId)?.name || ''
    modal.confirm({
      title: `确认清空数据？`,
      icon: <ClearOutlined style={{ color: '#ff4d4f' }} />,
      content: `将删除 ${yearName} 学年 ${gradeName} 年级的全部${kindLabel}记录（不可恢复，不影响学生档案与基础数据）。`,
      okText: '确认清空', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const r = await api('/data/clear', {
            method: 'POST',
            body: { academic_year_id: yearId, grade_id: gradeId, kind },
          })
          setResult(r)
          message.success(`已清空 ${r.deleted} 条${kindLabel}记录`)
        } catch (e) { message.error(e.message) }
      },
    })
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ marginBottom: 6 }}>学年</div>
          <Select style={{ width: '100%' }} placeholder="选择学年" value={yearId}
            options={years.map((y) => ({ value: y.id, label: y.name }))} onChange={setYearId} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ marginBottom: 6 }}>年级</div>
          <Select style={{ width: '100%' }} placeholder="选择年级" value={gradeId}
            options={grades.map((g) => ({ value: g.id, label: g.name }))} onChange={setGradeId} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ marginBottom: 6 }}>数据类型</div>
          <Select style={{ width: '100%' }} value={kind} onChange={setKind}
            options={[
              { value: 'score', label: '成绩记录（score_records）' },
              { value: 'eval', label: '综测记录（eval_records）' },
            ]} />
        </div>
        <Button danger type="primary" icon={<ClearOutlined />} disabled={!yearId || !gradeId} onClick={doClear}>
          清空该范围数据
        </Button>
        {result && (
          <Statistic title="本次清空记录数" value={result.deleted}
            suffix={<Tag style={{ marginLeft: 8 }}>{result.year} · {result.grade} · {result.kind === 'score' ? '成绩' : '综测'}</Tag>} />
        )}
      </Space>
    </div>
  )
}
