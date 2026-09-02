import { useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ProLayout } from '@ant-design/pro-components'
import { App as AntdApp } from 'antd'
import {
  AuditOutlined, BookOutlined, CloudUploadOutlined, DashboardOutlined,
  ExportOutlined, FormOutlined, ScheduleOutlined, TableOutlined,
  TeamOutlined, TrophyOutlined, UploadOutlined,
} from '@ant-design/icons'
import { getToken, getUser, setUser, setToken } from './api.js'
import Login from './pages/Login.jsx'
import ChangePasswordModal from './pages/ChangePasswordModal.jsx'
import Overview from './pages/Overview.jsx'
import ScoreImport from './pages/ScoreImport.jsx'
import EvalImport from './pages/EvalImport.jsx'
import EvalEntry from './pages/EvalEntry.jsx'
import EvalSummary from './pages/EvalSummary.jsx'
import Students from './pages/Students.jsx'
import ExportCenter from './pages/ExportCenter.jsx'
import BaseData from './pages/BaseData.jsx'
import Accounts from './pages/Accounts.jsx'
import Schemes from './pages/Schemes.jsx'
import LogsBatches from './pages/LogsBatches.jsx'

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
