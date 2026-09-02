import { useEffect, useState } from 'react'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { App as AntdApp, Button, Form, Input, InputNumber, Modal, Popconfirm, Select,
         Space, Table, Tabs } from 'antd'
import { api, isAdmin } from '../api.js'

function useList(path, deps = []) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const reload = async () => {
    setLoading(true)
    try { setItems(await api(path)) } catch { /* ignore */ } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, deps)
  return { items, loading, reload, setItems }
}

export default function BaseData() {
  const { message } = AntdApp.useApp()
  const colleges = useList('/base/colleges')
  const years = useList('/base/academic-years')
  const grades = useList('/base/grades')
  const classes = useList('/base/classes')

  const reloadAll = () => { colleges.reload(); years.reload(); grades.reload(); classes.reload() }

  return (
    <PageContainer content="学年、年级、班级、学院等基础数据管理。辅导员可新建学年/年级/班级（新建年级自动与自己绑定）。">
      <ProCard>
        <Tabs items={[
          { key: 'classes', label: '班级', children: (
            <ClassesTab data={classes} grades={grades} colleges={colleges} onChanged={reloadAll} />) },
          { key: 'grades', label: '年级', children: (
            <GradesTab data={grades} onChanged={reloadAll} />) },
          { key: 'years', label: '学年', children: (
            <YearsTab data={years} onChanged={reloadAll} />) },
          { key: 'colleges', label: '学院', children: (
            <CollegesTab data={colleges} onChanged={reloadAll} />) },
        ]} />
      </ProCard>
    </PageContainer>
  )
}

function TableWrap({ columns, data, addLabel, onAdd, canAdd = true }) {
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        {canAdd && <Button type="primary" color="blue" variant="solid" onClick={onAdd}>{addLabel}</Button>}
      </div>
      <Table rowKey="id" size="middle" dataSource={data.items} loading={data.loading}
        pagination={false} columns={columns} />
    </>
  )
}

function ClassesTab({ data, grades, colleges, onChanged }) {
  const { message } = AntdApp.useApp()
  const [editing, setEditing] = useState(null) // null | {} | record
  const [collegeFilter, setCollegeFilter] = useState(undefined)
  const [form] = Form.useForm()
  useEffect(() => {
    if (editing !== null) {
      form.setFieldsValue(editing.id ? editing : { name: '', grade_id: undefined, college_id: undefined, major: '' })
    }
  }, [editing])
  const save = async () => {
    const v = await form.validateFields()
    try {
      if (editing.id) await api(`/base/classes/${editing.id}`, { method: 'PUT', body: v })
      else await api('/base/classes', { method: 'POST', body: v })
      message.success('已保存'); setEditing(null); data.reload(); onChanged()
    } catch (e) { message.error(e.message) }
  }
  const items = collegeFilter
    ? data.items.filter((c) => c.college_id === collegeFilter)
    : data.items
  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button type="primary" color="blue" variant="solid" onClick={() => setEditing({})}>新建班级</Button>
        <Select allowClear placeholder="按学院筛选" style={{ width: 200 }} value={collegeFilter}
          options={colleges.items.map((c) => ({ value: c.id, label: c.name }))}
          onChange={setCollegeFilter} />
      </div>
      <Table rowKey="id" size="middle" dataSource={items} loading={data.loading}
        pagination={false} columns={[
          { title: '班级名称', dataIndex: 'name' },
          { title: '所属年级', dataIndex: 'grade_name', width: 120 },
          { title: '专业（排名分组）', dataIndex: 'major_effective', width: 170,
            render: (_, r) => r.major
              ? <span>{r.major}</span>
              : <span style={{ color: '#888' }}>{r.major_effective}（自动提取）</span> },
          { title: '学院', dataIndex: 'college_name', width: 140, render: (v) => v || '—' },
          { title: '操作', width: 160, render: (_, r) => (
            <Space>
              {isAdmin() && <a onClick={() => setEditing(r)}>编辑</a>}
              {isAdmin() && <Popconfirm title="确认删除该班级？" onConfirm={async () => {
                try { await api(`/base/classes/${r.id}`, { method: 'DELETE' }); message.success('已删除'); data.reload(); onChanged() }
                catch (e) { message.error(e.message) }
              }}><a style={{ color: 'red' }}>删除</a></Popconfirm>}
              {!isAdmin() && <span style={{ color: '#ccc' }}>—</span>}
            </Space>) },
        ]} />
      <Modal title={editing?.id ? '编辑班级' : '新建班级'} open={editing !== null}
        onCancel={() => setEditing(null)} onOk={save} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="班级名称" rules={[{ required: true, message: '请输入班级名称' }]}>
            <Input placeholder="如 建筑类2401" />
          </Form.Item>
          <Form.Item name="grade_id" label="所属年级" rules={[{ required: true, message: '请选择年级' }]}>
            <Select options={grades.items.map((g) => ({ value: g.id, label: g.name }))} />
          </Form.Item>
          <Form.Item name="major" label="专业（可选，排名分组用）"
            tooltip="留空时按班级名自动提取（如 建筑类2401 → 建筑类）；填写后以本字段为准，同年级同专业班级一起排名">
            <Input placeholder="留空自动提取，如 建筑类" />
          </Form.Item>
          <Form.Item name="college_id" label="学院（可选分组标签）">
            <Select allowClear options={colleges.items.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function GradesTab({ data, onChanged }) {
  const { message } = AntdApp.useApp()
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const save = async () => {
    const v = await form.validateFields()
    try {
      await api('/base/grades', { method: 'POST', body: v })
      message.success('已新建'); setOpen(false); form.resetFields(); data.reload(); onChanged()
    } catch (e) { message.error(e.message) }
  }
  return (
    <>
      <TableWrap data={data} addLabel="新建年级（辅导员将自动绑定）" onAdd={() => setOpen(true)}
        columns={[
          { title: '年级', dataIndex: 'name', width: 140 },
          { title: '入学年份', dataIndex: 'enrollment_year', width: 140 },
        ]} />
      <Modal title="新建年级" open={open} onCancel={() => setOpen(false)} onOk={save} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="年级名称" rules={[
            { required: true, message: '请输入年级名称' },
            { pattern: /^\d{2}级$/, message: '格式如 24级' }]}>
            <Input placeholder="24级" />
          </Form.Item>
          <Form.Item name="enrollment_year" label="入学年份（留空自动推算）">
            <InputNumber style={{ width: '100%' }} min={2000} max={2100} placeholder="如 2024" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function YearsTab({ data, onChanged }) {
  const { message } = AntdApp.useApp()
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(null) // null | record
  const [form] = Form.useForm()
  const [renameForm] = Form.useForm()
  useEffect(() => {
    if (renaming) renameForm.setFieldsValue({ name: renaming.name })
  }, [renaming])
  const save = async () => {
    const v = await form.validateFields()
    try {
      await api('/base/academic-years', { method: 'POST', body: v })
      message.success('已新建'); setOpen(false); form.resetFields(); data.reload(); onChanged()
    } catch (e) { message.error(e.message) }
  }
  const saveRename = async () => {
    const v = await renameForm.validateFields()
    try {
      await api(`/base/academic-years/${renaming.id}`, { method: 'PUT', body: v })
      message.success('已改名'); setRenaming(null); data.reload(); onChanged()
    } catch (e) { message.error(e.message) }
  }
  return (
    <>
      <TableWrap data={data} addLabel="新建学年" onAdd={() => setOpen(true)}
        columns={[{ title: '学年', dataIndex: 'name', width: 200 },
          { title: '操作', width: 120, render: (_, r) => isAdmin()
            ? <a onClick={() => setRenaming(r)}>改名</a>
            : <span style={{ color: '#ccc' }}>—</span> }]} />
      <Modal title="新建学年" open={open} onCancel={() => setOpen(false)} onOk={save} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="学年名称" rules={[
            { required: true, message: '请输入学年' },
            { pattern: /^\d{4}-\d{4}$/, message: '格式 YYYY-YYYY，结束年须为开始年+1' }]}>
            <Input placeholder="2024-2025" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={`学年改名：${renaming?.name || ''}`} open={!!renaming}
        onCancel={() => setRenaming(null)} onOk={saveRename} destroyOnHidden>
        <Form form={renameForm} layout="vertical">
          <Form.Item name="name" label="新学年名称" rules={[
            { required: true, message: '请输入学年' },
            { pattern: /^\d{4}-\d{4}$/, message: '格式 YYYY-YYYY' },
            ({ getFieldValue }) => ({
              validator: (_, v) => {
                const m = /^(\d{4})-(\d{4})$/.exec(v || '')
                if (!m || Number(m[2]) !== Number(m[1]) + 1) {
                  return Promise.reject(new Error('结束年须为开始年+1'))
                }
                return Promise.resolve()
              },
            })]}>
            <Input placeholder="2025-2026" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function CollegesTab({ data, onChanged }) {
  const { message } = AntdApp.useApp()
  const [name, setName] = useState('')
  const add = async () => {
    try {
      await api('/base/colleges', { method: 'POST', body: { name } })
      message.success('已新建'); setName(''); data.reload(); onChanged()
    } catch (e) { message.error(e.message) }
  }
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Input style={{ width: 260 }} placeholder="学院名称" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="primary" color="blue" variant="solid" disabled={!name.trim()} onClick={add}>新建学院</Button>
      </Space>
      <Table rowKey="id" size="middle" dataSource={data.items} loading={data.loading} pagination={false}
        columns={[
          { title: '学院', dataIndex: 'name' },
          { title: '操作', width: 120, render: (_, r) => isAdmin() && (
            <Popconfirm title="确认删除该学院？" onConfirm={async () => {
              try { await api(`/base/colleges/${r.id}`, { method: 'DELETE' }); message.success('已删除'); data.reload(); onChanged() }
              catch (e) { message.error(e.message) }
            }}><a style={{ color: 'red' }}>删除</a></Popconfirm>) },
        ]} />
    </>
  )
}
