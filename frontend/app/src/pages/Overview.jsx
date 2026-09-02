import { useEffect, useState } from 'react'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { App as AntdApp, Col, Drawer, Empty, Progress, Row, Select, Table, Tag } from 'antd'
import { api } from '../api.js'

export default function Overview() {
  const { message } = AntdApp.useApp()
  const [data, setData] = useState(null)
  const [yearId, setYearId] = useState(null)
  const [drill, setDrill] = useState(null) // 年级行

  useEffect(() => {
    api('/overview', { params: yearId ? { academic_year_id: yearId } : {} })
      .then((d) => { setData(d); if (!yearId && d.current_year_id) setYearId(d.current_year_id) })
      .catch((e) => message.error(e.message))
  }, [yearId])

  const columns = [
    { title: '年级', dataIndex: 'grade_name' },
    { title: '班级数', dataIndex: 'class_count', width: 90 },
    { title: '学生数', dataIndex: 'student_count', width: 90 },
    { title: '成绩记录数', dataIndex: 'score_records', width: 110 },
    {
      title: `综测完成度`, width: 220,
      render: (_, r) => (
        <>
          <Progress percent={r.eval_completion} size="small" style={{ width: 150 }} />
          <span style={{ color: '#999', fontSize: 12 }}>{r.eval_entered_students}/{r.student_count} 人</span>
        </>
      ),
    },
    {
      title: '未录入', width: 110,
      render: (_, r) => r.eval_unentered > 0
        ? <a onClick={() => setDrill(r)}><Tag color="orange">{r.eval_unentered} 人</Tag></a>
        : <Tag color="green">无</Tag>,
    },
  ]

  return (
    <PageContainer
      extra={[
        <Select key="year" style={{ width: 160 }} placeholder="选择学年" value={yearId}
          options={(data?.years || []).map((y) => ({ value: y.id, label: y.name }))}
          onChange={setYearId} />,
      ]}
    >
      <ProCard>
        {!data ? <Empty description="加载中…" /> : (
          <Table rowKey="grade_id" columns={columns} dataSource={data.grade_rows}
            pagination={false} size="middle" />
        )}
      </ProCard>
      <Drawer
        title={`未录入综测名单 · ${drill?.grade_name || ''}（${drill?.eval_unentered || 0} 人）`}
        width={520} open={!!drill} onClose={() => setDrill(null)}
      >
        <Row gutter={[8, 8]}>
          {(drill?.unentered_sample || []).map((s) => (
            <Col span={12} key={s.student_no}>
              <ProCard size="small" bordered>
                <b>{s.name}</b>　<span style={{ color: '#888' }}>{s.student_no} · {s.class_name}</span>
              </ProCard>
            </Col>
          ))}
        </Row>
        {(drill?.unentered_sample?.length || 0) === 0 && <Empty description="无未录入学生" />}
        {(drill?.eval_unentered || 0) > (drill?.unentered_sample?.length || 0) && (
          <div style={{ color: '#999', marginTop: 12 }}>仅显示前 50 人</div>
        )}
      </Drawer>
    </PageContainer>
  )
}
