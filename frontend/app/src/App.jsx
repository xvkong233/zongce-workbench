import { lazy, Suspense, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ProLayout } from '@ant-design/pro-components'
import { App as AntdApp, Skeleton } from 'antd'
import {
  AuditOutlined, BookOutlined, CloudUploadOutlined, DashboardOutlined,
  ExportOutlined, FormOutlined, ScheduleOutlined, TableOutlined,
  TeamOutlined, TrophyOutlined, UploadOutlined,
} from '@ant-design/icons'
import { getToken, getUser, setUser, setToken } from './api.js'
import Login from './pages/Login.jsx'
import ChangePasswordModal from './pages/ChangePasswordModal.jsx'

// 路由级代码分割：首屏只加载当前页所需代码，缩短白屏时间
const Overview = lazy(() => import('./pages/Overview.jsx'))
const ScoreImport = lazy(() => import('./pages/ScoreImport.jsx'))
const EvalImport = lazy(() => import('./pages/EvalImport.jsx'))
const EvalEntry = lazy(() => import('./pages/EvalEntry.jsx'))
const EvalSummary = lazy(() => import('./pages/EvalSummary.jsx'))
const Students = lazy(() => import('./pages/Students.jsx'))
const ExportCenter = lazy(() => import('./pages/ExportCenter.jsx'))
const BaseData = lazy(() => import('./pages/BaseData.jsx'))
const Accounts = lazy(() => import('./pages/Accounts.jsx'))
const Schemes = lazy(() => import('./pages/Schemes.jsx'))
const LogsBatches = lazy(() => import('./pages/LogsBatches.jsx'))

// 懒加载兜底骨架屏：模拟典型页面结构（页头 + 统计卡行 + 内容卡），替代转圈
const PAGE_FALLBACK = (
  <div style={{ padding: '24px 24px 48px' }}>
    <Skeleton active title={{ width: 160 }} paragraph={{ rows: 1, width: 280 }} />
    <div style={{ display: 'flex', gap: 16, marginTop: 20, flexWrap: 'wrap' }}>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} style={{ flex: '1 1 180px', background: '#fff',
                              border: '1px solid #f0f0f0', borderRadius: 8, padding: 16 }}>
          <Skeleton active title={false} avatar={{ shape: 'square', size: 44 }}
                    paragraph={{ rows: 1, width: '65%' }} />
        </div>
      ))}
    </div>
    <div style={{ marginTop: 16, background: '#fff', border: '1px solid #f0f0f0',
                  borderRadius: 8, padding: 16 }}>
      <Skeleton active title paragraph={{ rows: 5 }} />
    </div>
  </div>
)

const MENU = [
  { path: '/overview', name: '数据总览', icon: <DashboardOutlined /> },
  { path: '/score-import', name: '成绩导入', icon: <CloudUploadOutlined /> },
  { path: '/eval-import', name: '综测导入', icon: <UploadOutlined /> },
  { path: '/evals', name: '综测录入', icon: <FormOutlined /> },
  { path: '/summary', name: '综测汇总', icon: <TrophyOutlined /> },
  { path: '/students', name: '学生管理', icon: <TeamOutlined /> },
  { path: '/export', name: '导出中心', icon: <ExportOutlined /> },
  { path: '/base', name: '基础数据', icon: <BookOutlined /> },
  { path: '/users', name: '账号管理', icon: <AuditOutlined />, admin: true },
  { path: '/schemes', name: '综测方案', icon: <TableOutlined />, admin: true },
  { path: '/logs', name: '日志与批次', icon: <ScheduleOutlined />, admin: true },
]

function Shell({ user, onLogout }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { message } = AntdApp.useApp()
  const [pwdOpen, setPwdOpen] = useState(false)
  const menu = useMemo(
    () => MENU.filter((m) => !m.admin || user.role === 'admin')
      .map(({ admin: _a, ...rest }) => rest),
    [user.role])
  return (
    <ProLayout
      title="综测计算工作台"
      logo={null}
      layout="mix"
      fixSiderbar
      location={{ pathname: location.pathname }}
      menu={{ request: async () => menu }}
      menuItemRender={(item, dom) => (
        <a onClick={() => item.path && navigate(item.path)}>{dom}</a>
      )}
      avatarProps={{
        title: user.real_name || user.username,
        render: (_p, dom) => (
          <div onClick={() => {
            setPwdOpen(true)
          }} style={{ cursor: 'pointer' }}>
            {dom}
          </div>
        ),
      }}
      actionsRender={() => [
        <a key="logout" onClick={() => { onLogout(); message.success('已退出登录') }}>退出</a>,
      ]}
    >
      <Suspense fallback={PAGE_FALLBACK}>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/score-import" element={<ScoreImport />} />
          <Route path="/eval-import" element={<EvalImport />} />
          <Route path="/evals" element={<EvalEntry />} />
          <Route path="/summary" element={<EvalSummary />} />
          <Route path="/students" element={<Students />} />
          <Route path="/export" element={<ExportCenter />} />
          <Route path="/base" element={<BaseData />} />
          <Route path="/users" element={user.role === 'admin' ? <Accounts /> : <Navigate to="/overview" replace />} />
          <Route path="/schemes" element={user.role === 'admin' ? <Schemes /> : <Navigate to="/overview" replace />} />
          <Route path="/logs" element={user.role === 'admin' ? <LogsBatches /> : <Navigate to="/overview" replace />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </Suspense>
      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </ProLayout>
  )
}

export default function App() {
  const [logged, setLogged] = useState(!!getToken())
  const user = getUser() || { username: '', role: 'counselor', real_name: '' }
  const handleLogout = () => {
    setToken(null); setUser(null); setLogged(false)
  }
  if (!logged) {
    return <Routes>
      <Route path="*" element={<Login onOk={() => setLogged(true)} />} />
    </Routes>
  }
  return <Shell user={user} onLogout={handleLogout} />
}
