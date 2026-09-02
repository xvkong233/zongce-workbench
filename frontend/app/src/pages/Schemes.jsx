import { useEffect, useState } from 'react'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { App as AntdApp, Button, Form, Input, InputNumber, Popconfirm,
         Select, Space, Table, Tabs, Tag } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { api } from '../api.js'
import { useGrades, useYears } from './hooks.js'

const DEFAULT_ITEMS_SHAPE = [
  { name: '思想品德', max_score: 25, base_template: '基础分+23' },
  { name: '社会工作', max_score: 20, base_template: '' },
  { name: '科研及科技创新', max_score: 20, base_template: '' },
  { name: '文体活动', max_score: 15, base_template: '' },
  { name: '集体建设', max_score: 20, base_template: '班级基础分+7\n寝室基础分+8' },
]

export default function Schemes() {
  return (
    <PageContainer content="综测方案按学年配置；年级专属方案优先于默认方案。">
      <ProCard>
        <Tabs items={[
          { key: 'default', label: '默认方案', children: <DefaultScheme /> },
          { key: 'grade', label: '年级专属方案', children: <GradeSchemes /> },
          { key: 'conv', label: '等级换算表', children: <Conversions /> },
        ]} />
      </ProCard>
    </PageContainer>
  )
}

function ItemsEditor({ value = [], onChange }) {
  return (
    <Table size="small" pagination={false} rowKey={(r, i) => i}
      dataSource={value.length ? value : DEFAULT_ITEMS_SHAPE}
      columns={[
        { title: '项目名称', dataIndex: 'name', width: 180,
          render: (_, r, i) => <Input value={r.name} onChange={(e) => {
            const next = [...value]; next[i] = { ...r, name: e.target.value }; onChange(next)
          }} /> },
        { title: '满分', dataIndex: 'max_score', width: 120,
          render: (_, r, i) => <InputNumber value={r.max_score} min={0} onChange={(v) => {
            const next = [...value]; next[i] = { ...r, max_score: v ?? 0 }; onChange(next)
          }} /> },
        { title: '基础分模板（综测录入页可批量填充）',
          render: (_, r, i) => <Input.TextArea value={r.base_template} autoSize
            onChange={(e) => {
              const next = [...value]; next[i] = { ...r, base_template: e.target.value }; onChange(next)
            }} /> },
      ]} />
  )
}

function DefaultScheme() {
  const { message } = AntdApp.useApp()
  const years = useYears()
  const [yearId, setYearId] = useState(null)
  const [form] = Form.useForm()
  const [items, setItems] = useState(DEFAULT_ITEMS_SHAPE)
  const [inherited, setInherited] = useState(false)

  useEffect(() => {
    if (!yearId && years.length) setYearId(years[0].id)
  }, [years])
  useEffect(() => {
    if (!yearId) return
    api('/schemes/default', { params: { academic_year_id: yearId } }).then((s) => {
      form.setFieldsValue({ weight_academic: s.weight_academic, weight_eval: s.weight_eval, retake_rule: s.retake_rule })
      setItems(s.items)
      setInherited(s.inherited)
    }).catch((e) => message.error(e.message))
  }, [yearId])

  const save = async (v) => {
    try {
      await api(`/schemes/default?academic_year_id=${yearId}`, {
        method: 'PUT',
        body: { ...v, items },
      })
      message.success('方案已保存')
      setInherited(false)
    } catch (e) { message.error(e.message) }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <Select style={{ width: 180, marginBottom: 16 }} value={yearId}
        options={years.map((y) => ({ value: y.id, label: y.name }))}
        onChange={(v) => setYearId(v)} placeholder="选择学年" />
      {inherited && <div style={{ marginBottom: 8 }}><Tag color="blue">该学年暂无专属方案，当前展示全局默认值，保存后即为该学年方案</Tag></div>}
      <Form form={form} layout="vertical" onFinish={save}
        initialValues={{ weight_academic: 0.8, weight_eval: 0.2, retake_rule: 'latest' }}>
        <Space size="large">
          <Form.Item name="weight_academic" label="学业权重" rules={[{ required: true }]}>
            <InputNumber min={0} max={1} step={0.05} />
          </Form.Item>
          <Form.Item name="weight_eval" label="综测权重" rules={[{ required: true }]}>
            <InputNumber min={0} max={1} step={0.05} />
          </Form.Item>
          <Form.Item name="retake_rule" label="补考/重修取分规则" rules={[{ required: true }]}>
            <Select style={{ width: 200 }} options={[
              { value: 'latest', label: '取最新学期成绩' },
              { value: 'highest', label: '取最高分' },
            ]} />
          </Form.Item>
        </Space>
        <Form.Item label="综测项目（名称 / 满分 / 基础分模板）">
          <ItemsEditor value={items} onChange={setItems} />
        </Form.Item>
        <Button type="primary" color="blue" variant="solid" htmlType="submit">保存方案</Button>
      </Form>
    </div>
  )
}

function GradeSchemes() {
  const { message } = AntdApp.useApp()
  const years = useYears()
  const grades = useGrades()
  const [yearId, setYearId] = useState(null)
  const [rows, setRows] = useState([])
  const [form] = Form.useForm()
  const [items, setItems] = useState(DEFAULT_ITEMS_SHAPE)

  const reload = () => {
    if (!yearId) return
    api('/schemes/grade', { params: { academic_year_id: yearId } }).then(setRows).catch((e) => message.error(e.message))
  }
  useEffect(() => { if (!yearId && years.length) setYearId(years[0].id) }, [years])
  useEffect(reload, [yearId])
  // 切换学年后，项目配置预填该学年实际生效的默认方案（而非内置常量）
  useEffect(() => {
    if (!yearId) return
    api('/schemes/default', { params: { academic_year_id: yearId } })
      .then((s) => setItems(s.items)).catch(() => {})
  }, [yearId])

  const save = async () => {
    const v = await form.validateFields()
    try {
      await api(`/schemes/grade/${v.grade_id}?academic_year_id=${yearId}`, {
        method: 'PUT',
        body: { weight_academic: v.weight_academic, weight_eval: v.weight_eval,
                retake_rule: v.retake_rule, items },
      })
      message.success('年级专属方案已保存，计算时优先于默认方案')
      reload()
    } catch (e) { message.error(e.message) }
  }

  const hasScheme = (gid) => rows.some((r) => r.grade_id === gid)
  return (
    <div style={{ maxWidth: 900 }}>
      <Space style={{ marginBottom: 16 }}>
        <Select style={{ width: 180 }} value={yearId} options={years.map((y) => ({ value: y.id, label: y.name }))}
          onChange={setYearId} placeholder="选择学年" />
        {rows.length > 0 && <Tag color="orange">已有专属方案：{rows.map((r) => grades.find((g) => g.id === r.grade_id)?.name || r.grade_id).join('、')}</Tag>}
      </Space>
      <Form form={form} layout="vertical" onFinish={save}
        initialValues={{ weight_academic: 0.8, weight_eval: 0.2, retake_rule: 'latest' }}>
        <Space size="large" wrap>
          <Form.Item name="grade_id" label="年级" rules={[{ required: true }]}>
            <Select style={{ width: 140 }} options={grades.map((g) => ({
              value: g.id, label: g.name + (hasScheme(g.id) ? '（已有专属）' : ''),
            }))} onChange={(gid) => {
              const existed = rows.find((r) => r.grade_id === gid)
              if (existed) {  // 编辑已有专属方案：载入其现有配置
                setItems(existed.items)
                form.setFieldsValue({ weight_academic: existed.weight_academic,
                                      weight_eval: existed.weight_eval, retake_rule: existed.retake_rule })
              }
            }} />
          </Form.Item>
          <Form.Item name="weight_academic" label="学业权重" rules={[{ required: true }]}>
            <InputNumber min={0} max={1} step={0.05} />
          </Form.Item>
          <Form.Item name="weight_eval" label="综测权重" rules={[{ required: true }]}>
            <InputNumber min={0} max={1} step={0.05} />
          </Form.Item>
          <Form.Item name="retake_rule" label="补考取分" rules={[{ required: true }]}>
            <Select style={{ width: 170 }} options={[
              { value: 'latest', label: '取最新学期成绩' },
              { value: 'highest', label: '取最高分' },
            ]} />
          </Form.Item>
        </Space>
        <Form.Item label="项目配置（默认复制全局默认方案）">
          <ItemsEditor value={items} onChange={setItems} />
        </Form.Item>
        <Space>
          <Button type="primary" color="blue" variant="solid" htmlType="submit">保存年级专属方案</Button>
          {rows.length > 0 && (
            <Popconfirm title="选择年级并清除其专属方案（恢复跟随默认）">
              <span><ClearGradeScheme years={years} yearId={yearId} rows={rows} grades={grades} onDone={reload} /></span>
            </Popconfirm>
          )}
        </Space>
      </Form>
    </div>
  )
}

function ClearGradeScheme({ yearId, rows, grades, onDone }) {
  const { message } = AntdApp.useApp()
  const [gid, setGid] = useState(null)
  const doClear = async () => {
    if (!gid) { message.warning('请先在上方选择要清除的年级'); return }
    try {
      await api(`/schemes/grade/${gid}?academic_year_id=${yearId}`, { method: 'DELETE' })
      message.success('已清除，该年级恢复跟随默认方案')
      onDone()
    } catch (e) { message.error(e.message) }
  }
  return (
    <Space>
      <Select style={{ width: 160 }} placeholder="选择年级" value={gid} onChange={setGid}
        options={rows.map((r) => ({ value: r.grade_id, label: grades.find((g) => g.id === r.grade_id)?.name || r.grade_id }))} />
      <Button danger icon={<DeleteOutlined />} onClick={doClear}>清除专属方案</Button>
    </Space>
  )
}

function Conversions() {
  const { message } = AntdApp.useApp()
  const [rows, setRows] = useState([])
  const [form] = Form.useForm()
  const reload = () => api('/schemes/conversions').then(setRows).catch((e) => message.error(e.message))
  useEffect(reload, [])
  const add = async (v) => {
    try {
      await api('/schemes/conversions', { method: 'POST', body: v })
      form.resetFields(); reload(); message.success('已保存')
    } catch (e) { message.error(e.message) }
  }
  return (
    <div style={{ maxWidth: 720 }}>
      <Form form={form} layout="inline" onFinish={add} style={{ marginBottom: 16 }}>
        <Form.Item name="level_text" rules={[{ required: true, message: '等级文本' }]}>
          <Input placeholder="等级文本，如 良好" />
        </Form.Item>
        <Form.Item name="score" rules={[{ required: true, message: '分数' }]}>
          <InputNumber placeholder="百分制分数" min={0} max={100} />
        </Form.Item>
        <Form.Item name="level_group" initialValue="五级制" rules={[{ required: true }]}>
          <Select style={{ width: 130 }} options={[
            { value: '百分制', label: '百分制' },
            { value: '两级制', label: '两级制' },
            { value: '五级制', label: '五级制' },
          ]} />
        </Form.Item>
        <Button type="primary" color="blue" variant="solid" htmlType="submit">添加/更新</Button>
      </Form>
      <Table size="small" rowKey="id" dataSource={rows} pagination={false}
        columns={[
          { title: '等级文本', dataIndex: 'level_text', width: 140 },
          { title: '百分制分数', dataIndex: 'score', width: 120 },
          { title: '等级制', dataIndex: 'level_group', width: 120, render: (v) => <Tag>{v}</Tag> },
          { title: '操作', width: 100, render: (_, r) => (
            <Popconfirm title="删除该换算项？" onConfirm={async () => {
              await api(`/schemes/conversions/${r.id}`, { method: 'DELETE' }); reload()
            }}><a style={{ color: 'red' }}>删除</a></Popconfirm>) },
        ]} />
      <div style={{ color: '#999', marginTop: 8, fontSize: 12 }}>
        「合格」与「及格」严格区分：合格=80（两级制）、及格=65（五级制）。未匹配的等级记为异常，成绩保留入库但不计入统计。
      </div>
    </div>
  )
}
