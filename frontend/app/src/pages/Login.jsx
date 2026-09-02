import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExclamationCircleOutlined, EyeInvisibleOutlined, EyeOutlined,
         ExportOutlined, FileDoneOutlined, FormOutlined, LockOutlined,
         SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons'
import { App as AntdApp } from 'antd'
import { api, setToken, setUser } from '../api.js'
import ChangePasswordModal from './ChangePasswordModal.jsx'
import './Login.css'

const FEATURES = [
  { icon: <FormOutlined />, title: '成绩长表一键导入',
    desc: '自动识别学年学期、等级换算，异常清单全程留痕' },
  { icon: <FileDoneOutlined />, title: '综测在线录入与批量导入',
    desc: '五项明细封顶校验，排名按专业组内自动计算' },
  { icon: <ExportOutlined />, title: '一键导出汇总工作簿', gold: true,
    desc: 'output.xlsx 风格成绩/绩点双表与综测简表' },
]

export default function Login({ onOk }) {
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const [form, setForm] = useState({ username: '', password: '' })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [pending, setPending] = useState(null) // {username, password, token}
  const [pwdOpen, setPwdOpen] = useState(false)

  useEffect(() => { document.title = '登录 · 综测计算工作台' }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const next = {}
    if (!form.username.trim()) next.username = '请输入用户名'
    if (!form.password) next.password = '请输入密码'
    setErrors(next)
    if (Object.keys(next).length) return
    setLoading(true)
    try {
      const r = await api('/auth/login', {
        method: 'POST',
        body: { username: form.username.trim(), password: form.password },
      })
      if (r.must_change_password) {
        setPending({ ...form, token: r.token })
        setPwdOpen(true)
        return
      }
      setToken(r.token)
      setUser({ username: r.username, role: r.role, real_name: r.real_name })
      onOk()
      navigate('/overview')
    } catch (err) {
      message.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      {/* 左侧品牌面板 */}
      <aside className="auth-left">
        <div className="auth-glow" />
        <div className="auth-ring auth-ring-1" />
        <div className="auth-ring auth-ring-2" />
        <div className="auth-dot auth-dot-gold" />
        <div className="auth-dot auth-dot-1" />
        <div className="auth-dot auth-dot-2" />
        <div className="auth-hill auth-hill-1" />
        <div className="auth-hill auth-hill-2" />
        <div className="auth-hill auth-hill-3" />

        <div className="auth-left-inner auth-brand">
          <div className="auth-brand-box"><SafetyCertificateOutlined /></div>
          <span className="auth-brand-name">综测计算工作台</span>
        </div>

        <div className="auth-left-inner">
          <h2 className="auth-headline">
            从手工 Excel，
            <br />
            到一键综测汇总。
          </h2>
          <p className="auth-subtitle">
            面向高校辅导员的综合素质测评平台：成绩导入、综测录入、
            自动计算与排名、一键导出，全流程线上化完成。
          </p>
          <div className="auth-features">
            {FEATURES.map((f) => (
              <div className="auth-feature" key={f.title}>
                <div className={`auth-feature-icon${f.gold ? ' gold' : ''}`}>{f.icon}</div>
                <div>
                  <p className="auth-feature-title" style={{ margin: 0 }}>{f.title}</p>
                  <p className="auth-feature-desc" style={{ margin: 0 }}>{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="auth-left-inner auth-left-footer">
          © {new Date().getFullYear()} 综测计算工作台 · 数据仅用于校内综合测评
        </div>
      </aside>

      {/* 右侧登录表单 */}
      <main className="auth-right">
        <div className="auth-wrap">
          <div className="auth-mobile-brand">
            <div className="auth-mobile-box"><SafetyCertificateOutlined /></div>
            <span className="auth-mobile-name">综测计算工作台</span>
          </div>

          <div className="auth-card">
            <h1 className="auth-title">登录工作台</h1>
            <p className="auth-subtitle-sm">欢迎回来，请使用辅导员 / 管理员账号登录。</p>

            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              <div>
                <label className="auth-label" htmlFor="login-username">用户名</label>
                <div className={`auth-input${errors.username ? ' has-error' : ''}`}>
                  <UserOutlined className="auth-input-icon" />
                  <input
                    id="login-username"
                    type="text"
                    value={form.username}
                    placeholder="输入账号"
                    autoComplete="username"
                    autoFocus
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                  />
                </div>
                {errors.username && (
                  <p className="auth-error"><ExclamationCircleOutlined /> {errors.username}</p>
                )}
              </div>

              <div>
                <label className="auth-label" htmlFor="login-password">密码</label>
                <div className={`auth-input${errors.password ? ' has-error' : ''}`}>
                  <LockOutlined className="auth-input-icon" />
                  <input
                    id="login-password"
                    type={showPwd ? 'text' : 'password'}
                    value={form.password}
                    placeholder="输入密码"
                    autoComplete="current-password"
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                  <button
                    type="button"
                    className="auth-eye"
                    tabIndex={-1}
                    aria-label={showPwd ? '隐藏密码' : '显示密码'}
                    onClick={() => setShowPwd(!showPwd)}
                  >
                    {showPwd ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  </button>
                </div>
                {errors.password && (
                  <p className="auth-error"><ExclamationCircleOutlined /> {errors.password}</p>
                )}
              </div>

              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? (
                  <>
                    <svg className="auth-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    登录中…
                  </>
                ) : '登 录'}
              </button>
            </form>
          </div>

          <p className="auth-foot-note">
            首次登录或密码重置后需修改初始密码 · 连续失败 5 次将锁定 10 分钟
          </p>
        </div>
      </main>

      <ChangePasswordModal
        open={pwdOpen}
        onClose={() => setPwdOpen(false)}
        fixedOld={pending?.password}
        token={pending?.token}
        onDone={async (newToken) => {
          setToken(newToken)
          try {
            const me = await api('/auth/me')
            setUser(me)
          } catch { /* 理论上不会失败 */ }
          onOk()
          navigate('/overview')
        }}
      />
    </div>
  )
}
