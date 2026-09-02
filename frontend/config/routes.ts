export default [
  { path: '/user', layout: false, routes: [
    { path: '/user/login', name: '登录', component: './user/login' },
    { path: '/user/changepwd', name: '修改密码', component: './user/changepwd' },
    { path: '/user', redirect: '/user/login' },
  ]},
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: '数据总览', icon: 'appstore', component: './Dashboard' },
  { path: '/import', name: '成绩导入', icon: 'fileAdd', component: './ScoreImport' },
  { path: '/assessment', name: '综测录入', icon: 'calculator', component: './AssessmentEntry' },
  { path: '/summary', name: '综测汇总', icon: 'barChart', component: './Summary' },
  { path: '/students', name: '学生管理', icon: 'team', component: './Students' },
  { path: '/export', name: '导出中心', icon: 'download', component: './ExportCenter' },
  { path: '/basedata', name: '基础数据', icon: 'setting', component: './BaseData' },
  { path: '/users', name: '账号管理', icon: 'user', access: 'isAdmin', component: './Users' },
  { path: '/scheme', name: '测评方案', icon: 'key', access: 'isAdmin', component: './SchemeConfig' },
  { path: '/logs', name: '操作日志', icon: 'history', access: 'isAdmin', component: './Logs' },
  { path: '*', layout: false, component: './exception/404' },
];
