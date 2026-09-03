import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { App as AntdApp, Card, Col, Drawer, Empty, Progress, Row, Select, Spin,
         Statistic, Table, Tabs, Tag } from 'antd'
import { CloudUploadOutlined, ExportOutlined, FileDoneOutlined, FormOutlined,
         RightOutlined, SolutionOutlined, TeamOutlined, TrophyOutlined } from '@ant-design/icons'
import { api } from '../api.js'

// 中台快捷入口
const QUICK_ENTRIES = [
  { path: '/score-import', icon: <CloudUploadOutlined />, title: '成绩导入', desc: '教务长表一键入库',
    bg: '#e6f4ff', color: '#1677ff' },
  { path: '/evals', icon: <FormOutlined />, title: '综测录入', desc: '五项明细逐人录入',
    bg: '#f6ffed', color: '#52c41a' },
  { path: '/summary', icon: <TrophyOutlined />, title: '综测汇总', desc: '排名与合成成绩大表',
    bg: '#fff7e6', color: '#fa8c16' },
  { path: '/export', icon: <ExportOutlined />, title: '导出中心', desc: '汇总工作簿一键导出',
    bg: '#f9f0ff', color: '#722ed1' },
]

const ICON_BOX = { width: 46, height: 46, borderRadius: 10, fontSize: 22,
                   display: 'flex', alignItems: 'center', justifyContent: 'center' }

function StatCard({ icon, bg, color, label, value, suffix }) {
  return (
    <Card size="small" styles={{ body: { display: 'flex', alignItems: 'center', gap: 14 } }}>
      <div style={{ ...ICON_BOX, background: bg, color }}>{icon}</div>
      {suffix ?? <Statistic title={label} value={value} />}
    </Card>
  )
}

export default function Overview() {
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [yearId, setYearId] = useState(null)
  const [drill, setDrill] = useState(null) // 年级行

  useEffect(() => {
    api('/overview', { params: yearId ? { academic_year_id: yearId } : {} })
      .then((d) => { setData(d); if (!yearId && d.current_year_id) setYearId(d.current_year_id) })
      .catch((e) => message.error(e.message))
  }, [yearId])

  const totals = data?.totals || {}
  const gradeRows = data?.grade_rows || []

  const classColumns = [
    { title: '班级', dataIndex: 'name' },
    { title: '学生数', dataIndex: 'student_count', width: 90 },
    { title: '已录入', dataIndex: 'eval_entered', width: 90 },
    { title: '完成度', width: 200, render: (_, r) => (
      <Progress percent={r.eval_completion} size="small" style={{ width: 160 }}
        status={r.eval_completion >= 100 ? 'success' : 'normal'} />
    ) },
  ]

  return (
    <PageContainer
      content="所辖范围的本学年综测工作台中台：完成度一屏尽览，未录入名单与班级明细一键下钻。"
      extra={[
        <Select key="year" style={{ width: 160 }} placeholder="选择学年" value={yearId}
          options={(data?.years || []).map((y) => ({ value: y.id, label: y.name }))}
          onChange={setYearId} />,
      ]}
    >
      {!data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 120 }}>
          <Spin size="large" tip="加载中…"><span style={{ minWidth: 120 }} /></Spin>
        </div>
      ) : (
        <>
          {/* 全局统计 */}
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={12} lg={5}>
              <StatCard icon={<TeamOutlined />} bg="#e6f4ff" color="#1677ff"
                label="学生总数" value={totals.student_count ?? 0} />
            </Col>
            <Col xs={12} sm={12} lg={5}>
              <StatCard icon={<SolutionOutlined />} bg="#f6ffed" color="#52c41a"
                label="班级总数" value={totals.class_count ?? 0} />
            </Col>
            <Col xs={12} sm={12} lg={5}>
              <StatCard icon={<FileDoneOutlined />} bg="#fff7e6" color="#fa8c16"
                label="成绩记录数" value={totals.score_records ?? 0} />
            </Col>
            <Col xs={12} sm={12} lg={4}>
              <StatCard icon={<TeamOutlined />} bg="#f9f0ff" color="#722ed1"
                label="综测已录入" value={totals.eval_entered_students ?? 0} />
            </Col>
            <Col xs={24} sm={24} lg={5}>
              <Card size="small" styles={{ body: { display: 'flex', alignItems: 'center',
                                                   justifyContent: 'center', gap: 16 } }}>
                <Progress type="dashboard" size={72} percent={totals.eval_completion ?? 0}
                  strokeColor="#1677ff"
                  status={(totals.eval_completion ?? 0) >= 100 ? 'success' : 'normal'} />
                <div>
                  <div style={{ color: '#8c8c8c', fontSize: 13 }}>综测完成度</div>
                  <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                    {totals.eval_entered_students ?? 0}/{totals.student_count ?? 0} 人
                  </div>
                </div>
              </Card>
            </Col>
          </Row>

          {/* 快捷入口 */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            {QUICK_ENTRIES.map((q) => (
              <Col xs={12} lg={6} key={q.path}>
                <Card size="small" hoverable styles={{ body: { display: 'flex',
                                                                alignItems: 'center', gap: 12 } }}
                  onClick={() => navigate(q.path)}>
                  <div style={{ ...ICON_BOX, background: q.bg, color: q.color }}>{q.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{q.title}</div>
                    <div style={{ color: '#8c8c8c', fontSize: 12 }}>{q.desc}</div>
                  </div>
                  <RightOutlined style={{ color: '#bfbfbf', fontSize: 12 }} />
                </Card>
              </Col>
            ))}
          </Row>

          {/* 年级看板 */}
          <ProCard title="年级综测完成度" style={{ marginTop: 16 }}
            extra={<span style={{ color: '#999', fontSize: 12 }}>点击「未录入」查看名单与班级明细</span>}>
            {gradeRows.length === 0 ? (
              <Empty description="所辖范围内暂无年级数据" />
            ) : (
              <Row gutter={[16, 16]}>
                {gradeRows.map((g) => (
                  <Col xs={24} sm={12} xl={8} key={g.grade_id}>
                    <Card size="small" styles={{ body: { display: 'flex', gap: 16,
                                                         alignItems: 'center' } }}>
                      <Progress type="dashboard" size={92} percent={g.eval_completion}
                        strokeColor="#1677ff"
                        status={g.eval_completion >= 100 ? 'success' : 'normal'} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between',
                                      alignItems: 'center' }}>
                          <b style={{ fontSize: 15 }}>{g.grade_name}</b>
                          {g.eval_unentered > 0 ? (
                            <a onClick={() => setDrill(g)}>
                              <Tag color="orange" style={{ cursor: 'pointer', marginInlineEnd: 0 }}>
                                未录入 {g.eval_unentered} 人
                              </Tag>
                            </a>
                          ) : (
                            <Tag color="green" style={{ marginInlineEnd: 0 }}>全员已录入</Tag>
                          )}
                        </div>
                        <div style={{ color: '#595959', fontSize: 12, marginTop: 6, lineHeight: 1.9 }}>
                          学生 {g.student_count} 人 · 班级 {g.class_count} 个 · 已录入 {g.eval_entered_students} 人
                          <br />
                          成绩记录 {g.score_records} 条
                        </div>
                      </div>
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </ProCard>
        </>
      )}

      <Drawer
        title={`综测进度 · ${drill?.grade_name || ''}`}
        width={620} open={!!drill} onClose={() => setDrill(null)}
      >
        {drill && (
          <Tabs items={[
            { key: 'unentered', label: `未录入名单（${drill.eval_unentered}）`, children: (
              <>
                <Row gutter={[8, 8]}>
                  {(drill.unentered_sample || []).map((s) => (
                    <Col span={12} key={s.student_no}>
                      <ProCard size="small" bordered>
                        <b>{s.name}</b>
                        <span style={{ color: '#888', marginLeft: 8 }}>
                          {s.student_no} · {s.class_name}
                        </span>
                      </ProCard>
                    </Col>
                  ))}
                </Row>
                {(drill.unentered_sample?.length || 0) === 0 && <Empty description="无未录入学生" />}
                {(drill.eval_unentered || 0) > (drill.unentered_sample?.length || 0) && (
                  <div style={{ color: '#999', marginTop: 12 }}>仅显示前 50 人</div>
                )}
              </>
            ) },
            { key: 'classes', label: `班级完成度（${drill.class_count}）`, children: (
              <Table rowKey="id" size="small" pagination={false}
                dataSource={drill.classes || []} columns={classColumns} />
            ) },
          ]} />
        )}
      </Drawer>
    </PageContainer>
  )
}
