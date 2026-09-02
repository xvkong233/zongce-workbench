import { useEffect, useState } from 'react'
import { api } from '../api.js'

export function useYears() {
  const [years, setYears] = useState([])
  useEffect(() => { api('/base/academic-years').then(setYears).catch(() => {}) }, [])
  return years
}

export function useGrades() {
  const [grades, setGrades] = useState([])
  useEffect(() => { api('/base/grades').then(setGrades).catch(() => {}) }, [])
  return grades
}

export function useClasses(gradeId) {
  const [classes, setClasses] = useState([])
  useEffect(() => {
    api('/base/classes', { params: gradeId ? { grade_id: gradeId } : {} })
      .then(setClasses).catch(() => {})
  }, [gradeId])
  return classes
}
