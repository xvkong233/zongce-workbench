import { ModalForm, ProFormText } from '@ant-design/pro-components'
import { App as AntdApp } from 'antd'
import { useState } from 'react'
import { api, getUser, setUser } from '../api.js'

/**
 * 修改密码弹窗。首登强制改密场景：old_password 由登录表单回传（fixedOld），
 * 请求直接用登录返回的临时 token。
 */
export default function ChangePasswordModal({ open, onClose, fixedOld, token, onDone }) {
  const { message } = AntdApp.useApp()
  const [loading, setLoading] = useState(false)
  return (
    <ModalForm
      title="修改密码"
      open={open}
      submitter={{ searchConfig: { submitText: '确认修改' }, resetButtonProps: { style: { display: fixedOld ? 'none' : undefined } } }}
      modalProps={{ destroyOnHidden: true, onCancel: () => { if (!fixedOld) onClose() }, maskClosable: !fixedOld, keyboard: !fixedOld, closable: !fixedOld }}
      onFinish={async (values) => {
        setLoading(true)
        try {
          const headers = token ? { Authorization: `Bearer ${token}` } : undefined
          const res = await fetch('/api/auth/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(headers || {}) },
            body: JSON.stringify({ old_password: fixedOld ?? values.old_password, new_password: values.new_password }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data?.detail?.message || '修改失败')
          const u = getUser()
          message.success('密码已修改，请使用新密码')
          onDone?.(data.token, u)
          onClose()
          return true
        } catch (e) {
          message.error(e.message)
          return false
        } finally {
          setLoading(false)
        }
      }}
    >
      {!fixedOld && (
        <ProFormText.Password name="old_password" label="原密码"
          rules={[{ required: true, message: '请输入原密码' }]} />
      )}
      <ProFormText.Password name="new_password" label="新密码" placeholder="至少 6 位"
        rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '至少 6 位' }]} />
      <ProFormText.Password name="confirm" label="确认新密码"
        dependencies={['new_password']}
        rules={[{ required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator: (_, v) => v === getFieldValue('new_password')
                    ? Promise.resolve() : Promise.reject(new Error('两次输入不一致')),
                })]} />
    </ModalForm>
  )
}
