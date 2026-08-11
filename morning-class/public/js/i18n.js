/* Salt Morning Class — lightweight EN/KO UI language toggle */
window.SaltI18n = (function () {
  const STORAGE_KEY = 'salt_ui_lang';

  const dict = {
    en: {
      'lang.toggle': '한국어',
      'lang.toggle.title': 'Switch to Korean',
      'nav.logout': 'Log out',
      'nav.monitor': 'Monitor',
      'nav.lessons': 'Lessons',
      'nav.teachers': 'Teachers',
      'nav.classes': 'Classes',
      'nav.students': 'Students',
      'nav.timetables': 'Timetables',
      'nav.schoolCal': 'Calendar',
      'nav.terms': 'Terms',
      'nav.announcements': 'News',
      'nav.reportCards': 'Reports',
      'nav.analytics': 'Analytics',
      'nav.vocabPlatform': 'Vocab',
      'nav.feed': 'Newsfeed',
      'nav.parentAnnouncements': 'Announcements',
      'nav.attendance': 'Attendance',
      'nav.timetable': 'Timetable',
      'nav.homework': 'Homework',
      'nav.parentReports': 'Report cards',
      'nav.profile': 'Profile',
      'admin.brand': 'Salt Admin',
      'admin.page.monitor': 'Monitoring',
      'admin.page.lessons': 'Lesson plans',
      'admin.page.teachers': 'Teachers',
      'admin.page.classes': 'Classes',
      'admin.page.students': 'Students',
      'admin.page.timetables': 'Timetables',
      'admin.page.schoolCal': 'School calendar',
      'admin.page.terms': 'Term dates',
      'admin.page.announcements': 'Announcements',
      'admin.page.reportCards': 'Report cards',
      'admin.page.analytics': 'Learning Analytics',
      'admin.page.vocabPlatform': 'Vocab Booster',
      'admin.monitor.refresh': 'Refresh',
      'admin.monitor.allClasses': 'All classes',
      'admin.monitor.allActivity': 'All activity',
      'admin.teachers.title': 'Teachers',
      'admin.teachers.help': 'Manage accounts, profiles, and photos.',
      'admin.teachers.add': '+ Add teacher',
      'admin.analytics.title': 'Learning Analytics',
      'admin.analytics.help': 'School-wide SR/MAP trends, engagement, and early-warning badges for every enrolled student.',
      'admin.analytics.allClasses': 'All classes',
      'admin.analytics.allStatuses': 'All statuses',
      'admin.analytics.refresh': 'Refresh',
      'admin.analytics.seed': 'Load demo data',
      'admin.analytics.importSummary': 'Import Star Reading / MAP (PDF or scan)',
      'admin.analytics.importHelp': 'Choose a class, then upload the official report PDF or a clear photo/scan.',
      'admin.analytics.importBtn': 'Analyze & import',
      'admin.analytics.analyze': 'Analyze',
      'admin.rc.help': 'Principal queue — sign submitted cards, then share (or schedule share) with parents.',
      'admin.vocab.title': 'Vocab Booster',
      'admin.vocab.help': 'Central Vocab Booster console — tenants, curriculum packs, learners, and analytics for Salt Morning.',
      'admin.vocab.open': 'Open Vocab Booster',
      'parent.brand': 'Parent',
      'parent.hero.child': 'My child',
      'parent.hero.hwPending': 'homework pending',
      'parent.hero.reports': 'report card(s)',
      'parent.message.title': 'Message',
      'parent.message.help': 'Chat with teachers or the school office. Use Auto Translate in the bubble for Korean.',
      'parent.feed.title': 'Updates',
      'parent.ann.title': 'Announcements',
      'parent.ann.help': 'School office and class teacher messages in one place.',
      'parent.profile.title': 'Student information',
      'parent.profile.help': 'Update contact and medical details for',
      'parent.profile.photoNote': 'Photo is managed by the school office (Admin).',
      'parent.profile.parent': 'Parent / guardian',
      'parent.profile.contact': 'Student contact',
      'parent.profile.emergency': 'Emergency',
      'parent.profile.medical': 'Medical',
      'parent.profile.save': 'Save profile',
      'parent.profile.name': 'Name',
      'parent.profile.phone': 'Phone',
      'parent.profile.email': 'Email',
      'parent.profile.nationality': 'Nationality',
      'parent.profile.address': 'Address',
      'parent.profile.emergencyContact': 'Emergency contact',
      'parent.profile.emergencyPhone': 'Emergency phone',
      'parent.profile.notes': 'Notes',
      'common.loading': 'Loading…',
      'common.refresh': 'Refresh',
      'common.close': 'Close',
      'common.save': 'Save',
      'la.on_track': 'On Track',
      'la.attention': 'Attention',
      'la.warning': 'Warning',
      'la.intervention': 'Intervention',
      'la.student': 'Student',
      'la.class': 'Class',
      'la.status': 'Status',
      'la.empty': 'No students match this filter.',
      'la.diagnose': 'Generate AI learning profile'
    },
    ko: {
      'lang.toggle': 'English',
      'lang.toggle.title': '영어로 전환',
      'nav.logout': '로그아웃',
      'nav.monitor': '모니터링',
      'nav.lessons': '레슨플랜',
      'nav.teachers': '교사',
      'nav.classes': '클래스',
      'nav.students': '학생',
      'nav.timetables': '시간표',
      'nav.schoolCal': '학사일정',
      'nav.terms': '학기',
      'nav.announcements': '공지',
      'nav.reportCards': '성적표',
      'nav.analytics': '학습분석',
      'nav.vocabPlatform': '보캡부스터',
      'nav.feed': '새소식',
      'nav.parentAnnouncements': '공지사항',
      'nav.attendance': '출석',
      'nav.timetable': '시간표',
      'nav.homework': '숙제',
      'nav.parentReports': '성적표',
      'nav.profile': '프로필',
      'admin.brand': '솔트 관리자',
      'admin.page.monitor': '모니터링',
      'admin.page.lessons': '레슨플랜',
      'admin.page.teachers': '교사',
      'admin.page.classes': '클래스',
      'admin.page.students': '학생',
      'admin.page.timetables': '시간표',
      'admin.page.schoolCal': '학사 일정',
      'admin.page.terms': '학기 일정',
      'admin.page.announcements': '공지사항',
      'admin.page.reportCards': '성적표',
      'admin.page.analytics': '학습 분석',
      'admin.page.vocabPlatform': '보캡부스터',
      'admin.monitor.refresh': '새로고침',
      'admin.monitor.allClasses': '전체 클래스',
      'admin.monitor.allActivity': '전체 활동',
      'admin.teachers.title': '교사',
      'admin.teachers.help': '계정·프로필·사진을 관리합니다.',
      'admin.teachers.add': '+ 교사 추가',
      'admin.analytics.title': '학습 분석',
      'admin.analytics.help': '전교 재학생의 SR/MAP 추이, 참여도, 조기 경보 배지를 확인합니다.',
      'admin.analytics.allClasses': '전체 클래스',
      'admin.analytics.allStatuses': '전체 상태',
      'admin.analytics.refresh': '새로고침',
      'admin.analytics.seed': '데모 데이터 불러오기',
      'admin.analytics.importSummary': 'Star Reading / MAP 가져오기 (PDF 또는 스캔)',
      'admin.analytics.importHelp': '클래스를 선택한 뒤 공식 성적표 PDF 또는 선명한 사진을 업로드하세요.',
      'admin.analytics.importBtn': '분석 후 가져오기',
      'admin.analytics.analyze': '분석',
      'admin.rc.help': '교장 대기열 — 제출된 성적표에 서명하고 학부모와 공유합니다.',
      'admin.vocab.title': '보캡부스터',
      'admin.vocab.help': '솔트 모닝용 보캡부스터 관리 콘솔입니다.',
      'admin.vocab.open': '보캡부스터 열기',
      'parent.brand': '학부모',
      'parent.hero.child': '우리 아이',
      'parent.hero.hwPending': '건의 미완료 숙제',
      'parent.hero.reports': '개의 성적표',
      'parent.message.title': '메시지',
      'parent.message.help': '교사 또는 학교 사무실과 대화하세요. 말풍선의 자동번역으로 한국어를 볼 수 있습니다.',
      'parent.feed.title': '새소식',
      'parent.ann.title': '공지사항',
      'parent.ann.help': '학교 사무실과 담임 교사 메시지를 한곳에서 확인합니다.',
      'parent.profile.title': '학생 정보',
      'parent.profile.help': '연락처와 의료 정보를 업데이트하세요 —',
      'parent.profile.photoNote': '사진은 학교 사무실(관리자)에서 관리합니다.',
      'parent.profile.parent': '학부모 / 보호자',
      'parent.profile.contact': '학생 연락처',
      'parent.profile.emergency': '비상 연락',
      'parent.profile.medical': '의료 정보',
      'parent.profile.save': '프로필 저장',
      'parent.profile.name': '이름',
      'parent.profile.phone': '전화',
      'parent.profile.email': '이메일',
      'parent.profile.nationality': '국적',
      'parent.profile.address': '주소',
      'parent.profile.emergencyContact': '비상 연락처',
      'parent.profile.emergencyPhone': '비상 전화',
      'parent.profile.notes': '메모',
      'common.loading': '불러오는 중…',
      'common.refresh': '새로고침',
      'common.close': '닫기',
      'common.save': '저장',
      'la.on_track': '정상',
      'la.attention': '주의',
      'la.warning': '경고',
      'la.intervention': '개입 필요',
      'la.student': '학생',
      'la.class': '클래스',
      'la.status': '상태',
      'la.empty': '이 조건에 맞는 학생이 없습니다.',
      'la.diagnose': 'AI 학습 프로필 생성'
    }
  };

  let lang = 'en';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') lang = saved;
  } catch (_) { /* ignore */ }

  function t(key, fallback) {
    const pack = dict[lang] || dict.en;
    if (pack[key] != null) return pack[key];
    if (dict.en[key] != null) return dict.en[key];
    return fallback != null ? fallback : key;
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const val = t(key);
      if (el.tagName === 'OPTION' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.tagName === 'OPTION') el.textContent = val;
      } else {
        el.textContent = val;
      }
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    try {
      document.documentElement.lang = lang === 'ko' ? 'ko' : 'en';
    } catch (_) { /* ignore */ }
    const btn = document.getElementById('langToggleBtn');
    if (btn) {
      btn.textContent = t('lang.toggle');
      btn.title = t('lang.toggle.title');
    }
  }

  function setLang(next) {
    lang = next === 'ko' ? 'ko' : 'en';
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) { /* ignore */ }
    apply(document);
    try {
      window.dispatchEvent(new CustomEvent('salt:langchange', { detail: { lang } }));
    } catch (_) { /* ignore */ }
    return lang;
  }

  function toggle() {
    return setLang(lang === 'ko' ? 'en' : 'ko');
  }

  function getLang() { return lang; }

  function bindToggle(btn) {
    if (!btn) return;
    btn.addEventListener('click', () => toggle());
    apply(document);
  }

  return { t, apply, setLang, toggle, getLang, bindToggle, dict };
})();
