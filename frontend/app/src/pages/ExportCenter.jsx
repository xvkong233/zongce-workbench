import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { App as AntdApp, Alert, Button, Select, Space, Switch } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { api, download } from '../api.js'
import { confirmExportWithIssues } from './exportGuard.jsx'
import { useGrades, useYears } from './hooks.js'

export default function ExportCenter() {
  const { message, modal } = AntdApp.useApp()
  const navigate = useNavigate()
  const years = useYears()
  const grades = useGrades()
  const [yearId, setYearId] = useState(undefined)
  const [gradeIds, setGradeIds] = useState([])
  const [brief, setBrief] = useState(false)
  const [loading, setLoading] = useState(false)

  const doExport = async () => {
    if (!yearId || gradeIds.length === 0) {
      message.warning('请选择学年与至少一个年级')
      return
    }
    const proceed = await confirmExportWithIssues({ modal, navigate, yearId, gradeIds })
    if (!proceed) return
    setLoading(true)
    try {
      const res = await api('/export/workbook', {
        method: 'POST', raw: true,
        body: { academic_year_id: yearId, grade_ids: gradeIds, brief },
      })
      await download(res)
      message.success('导出成功，正在下载')
    } catch (e) { message.error(e.message) } finally { setLoading(false) }
  }

  return (
    <PageContainer content="生成 output.xlsx 风格的学年综测汇总工作簿：每个年级「成绩 + 绩点」两个 sheet；简表为单 sheet（评奖/存档用）。智育/综测排名按专业内计算（班级名去班号后相同的班级为一组）。">
      <ProCard style={{ maxWidth: 640 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <div style={{ marginBottom: 6 }}>学年</div>
            <Select style={{ width: '100%' }} placeholder="选择学年" value={yearId}
              options={years.map((y) => ({ value: y.id, label: y.name }))} onChange={setYearId} />
          </div>
          <div>
            <div style={{ marginBottom: 6 }}>年级（可多选）</div>
            <Select style={{ width: '100%' }} mode="multiple" placeholder="选择要导出的年级"
              value={gradeIds} onChange={setGradeIds}
              options={grades.map((g) => ({ value: g.id, label: g.name }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={brief} onChange={setBrief} />
            仅导出综测简表（不含课程矩阵）
          </div>
          <Alert type="info" showIcon message="如需按班级过滤，请到「综测汇总」页按班级导出" />
          <Button type="primary" color="blue" variant="solid" size="large" block
            icon={<DownloadOutlined />} loading={loading} onClick={doExport}>
            生成并下载
          </Button>
        </Space>
      </ProCard>
    </PageContainer>
  )
}
