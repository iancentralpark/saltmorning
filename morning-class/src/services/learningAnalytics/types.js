/**
 * Learning Analytics — TypeScript-style JSDoc contracts
 * (Sheets-backed; no Prisma in this stack.)
 *
 * @typedef {'star_reading'|'map'|'formative'|'other'} ExternalTestSource
 * @typedef {'on_track'|'attention'|'warning'|'intervention'} AnalyticsStatus
 * @typedef {'vocabulary'|'reading_comprehension'|'critical_thinking'|'fluency'|'grammar'|'math_operations'|'other'} DomainKey
 *
 * @typedef {Object} DomainScore
 * @property {DomainKey|string} domain
 * @property {number|null} score
 * @property {number|null} [percentile]
 * @property {string} [label]
 *
 * @typedef {Object} TestReport
 * @property {string} reportId
 * @property {string} studentId
 * @property {string} classId
 * @property {ExternalTestSource} source
 * @property {string} testDate  YYYY-MM-DD
 * @property {number|null} score
 * @property {number|null} percentile
 * @property {string|null} lexile
 * @property {number|null} ritScore
 * @property {DomainScore[]} domainScores
 * @property {Object} [rawMeta]
 * @property {string} [createdAt]
 *
 * @typedef {Object} DailyEngagementLog
 * @property {string} logId
 * @property {string} studentId
 * @property {string} classId
 * @property {string} date
 * @property {number|null} vocabScore          0–100
 * @property {number|null} formativeScore      0–100
 * @property {number} homeworkSubmitted        0/1 count submitted that day
 * @property {number} homeworkAssigned         assigned count that day
 * @property {number|null} participation       0–100
 * @property {string} [notes]
 * @property {string} [createdAt]
 *
 * @typedef {Object} EngagementSummary
 * @property {number} homeworkCompletionRate   0–1
 * @property {number} pendingHomework
 * @property {number|null} avgVocabScore
 * @property {number|null} avgFormativeScore
 * @property {number|null} avgParticipation
 * @property {number} daysLogged
 *
 * @typedef {Object} GrowthPoint
 * @property {string} date
 * @property {string} series   e.g. star_reading|map|vocab|formative|grades
 * @property {number} value
 * @property {string} [label]
 *
 * @typedef {Object} DomainProfile
 * @property {string} domain
 * @property {string} label
 * @property {number|null} latestScore
 * @property {number|null} trendDelta
 * @property {'strength'|'developing'|'weakness'|'unknown'} band
 *
 * @typedef {Object} StatusResult
 * @property {AnalyticsStatus} status
 * @property {string} label
 * @property {string[]} rootCauses
 * @property {string[]} signals
 * @property {Object} metrics
 *
 * @typedef {Object} InterventionRecord
 * @property {string} interventionId
 * @property {string} studentId
 * @property {string} classId
 * @property {AnalyticsStatus} status
 * @property {string[]} rootCauses
 * @property {string} teacherReport
 * @property {string} parentReport
 * @property {string[]} recommendedActions
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {Object} StudentAnalyticsBundle
 * @property {string} studentId
 * @property {string} name
 * @property {string} classId
 * @property {TestReport[]} testReports
 * @property {DailyEngagementLog[]} dailyLogs
 * @property {EngagementSummary} engagement
 * @property {GrowthPoint[]} progressSeries
 * @property {DomainProfile[]} domainProfile
 * @property {StatusResult} status
 * @property {InterventionRecord|null} latestIntervention
 */

module.exports = {};
