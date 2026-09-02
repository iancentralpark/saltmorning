module.exports = {
  ...require('./analyticsService'),
  ...require('./statusEngine'),
  ...require('./assessmentParser'),
  seedLearningAnalyticsMock: require('./analyticsSeed').seedLearningAnalyticsMock,
  generateAiDiagnostic: require('./diagnosticService').generateAiDiagnostic,
  ...require('./teacherNotesService')
};
