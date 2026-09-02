import { useEffect, useRef, useState } from 'react'
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormSelect, ProFormSwitch } from '@ant-design/pro-components'
import { App as AntdApp, Button, Popconfirm } from 'antd'
import { api } from '../api.js'
import { useGrades } from './hooks.js'

export default function Accounts() {
  const { message, modal } = AntdApp.useApp()
  const tableRef = useRef()
  const grades = useGrades()
  const [editing, setEditing] = useState(undefined) // undefined=关闭, {}=新建, record=编辑
  const [open, setOpen] = useState(false)

  const gradeOptions = grades.map((g) => ({ value: g.id, label: g.name }))

  const request = async () => {
    try { return { data: await api('/users'), total: 999, success: true } }
    catch (e) { message.error(e.message); return { data: [], total: 0, success: false } }
  }

  const finish = async (values) => {
    try {
      if (editing.id) await api(`/users/${editing.id}`, { method: 'PUT', body: values })
      else await api('/users', { method: 'POST', body: values })
      message.success(editing.id ? '已保存' : '已创建（首次登录需修改密码）')
      setOpen(false); setEditing(undefined); tableRef.current.reload()
      return true
    } catch (e) { message.error(e.message); return false }
  }

  return (
    <PageContainer content="辅导员账号管理：新建/编辑/禁用/重置密码/绑定年级。被重置的账号首次登录将强制改密。">
      <ProTable rowKey="id" actionRef={tableRef} request={request} search={false} pagination={false}
        toolBarRender={() => [
          <Button key="add" type="primary" color="blue" variant="solid"
            onClick={() => { setEditing({}); setOpen(true) }}>新建辅导员</Button>,
        ]}
        columns={[
          { title: '用户名', dataIndex: 'username' },
          { title: '姓名', dataIndex: 'real_name' },
          { title: '绑定年级', dataIndex: 'grade_names',
            render: (v) => (v || []).join('、') || '—' },
          { title: '状态', dataIndex: 'enabled', width: 90,
            render: (v) => v ? '启用' : '禁用' },
          { title: '待改密', dataIndex: 'must_change_password', width: 90,
            render: (v) => v ? '是' : '—' },
          { title: '操作', valueType: 'option', width: 140, render: (_, r) => [
            <a key="edit" onClick={() => { setEditing(r); setOpen(true) }}>编辑</a>,
            <Popconfirm key="del" title={`确认删除 ${r.username}？`} onConfirm={async () => {
              try { await api(`/users/${r.id}`, { method: 'DELETE' }); message.success('已删除'); tableRef.current.reload() }
              catch (e) { message.error(e.message) }
            }}><a style={{ color: 'red' }}>删除</a></Popconfirm>,
          ] },
        ]}
      />
      <ModalForm
        title={editing?.id ? `编辑账号：${editing.username}` : '新建辅导员'}
        open={open}
        modalProps={{ destroyOnHidden: true, onCancel: () => { setOpen(false); setEditing(undefined) } }}
        initialValues={editing?.id
          ? { real_name: editing.real_name, enabled: editing.enabled, grade_ids: editing.grade_ids, password: '' }
          : { enabled: true, must_change_password: true }}
        onFinish={finish}
      >
        {!editing?.id && <ProFormText name="username" label="用户名" rules={[{ required: true }]} />}
        <ProFormText name="real_name" label="姓名" />
        <ProFormText.Password name="password"
          label={editing?.id ? '重置密码（留空不改）' : '初始密码'}
          placeholder={editing?.id ? '留空表示不修改' : '必填'}
          rules={editing?.id ? [] : [{ required: true, message: '请输入初始密码' }]} />
        <ProFormSelect name="grade_ids" label="绑定年级（可多选）" mode="multiple" options={gradeOptions} />
        <ProFormSwitch name="enabled" label="启用账号" />
      </ModalForm>
    </PageContainer>
  )
}
