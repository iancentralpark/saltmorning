'use strict';

/**
 * Korean middle-school English grammar catalog (내신 문법 포인트).
 * Seeded from typical 2015/2022 textbook grammar scopes
 * (중1–중3 교과서 출판사별 문법 목차 연계).
 */

const QUESTION_TYPES = [
  'SENTENCE_AUTHENTICITY_SINGLE',
  'SENTENCE_AUTHENTICITY_MULTIPLE',
  'SENTENCE_AUTHENTICITY_COMBINED',
  'UNDERLINE_CORRECTION',
  'USAGE_CLASSIFICATION',
  'BLANK_COMPLETION',
  'SENTENCE_TRANSFORM',
  'DESCRIPTIVE_CORRECTION',
  'ORDERING_WITH_CONDITIONS',
  'FULL_SENTENCE_COMPOSITION'
];

const MVP_TYPES = QUESTION_TYPES.slice();

function unit(unitId, grade, category, subCategory, coreRules, traps, keywords) {
  const kw = Array.isArray(keywords) ? keywords : [];
  return {
    unitId,
    grade,
    category,
    subCategory,
    coreRules: coreRules || [],
    keywords: kw,
    errorTraps: (traps || []).map((t, i) => ({
      trapId: t.trapId || (unitId.toLowerCase() + '_' + (i + 1)),
      description: t.description,
      incorrectPattern: t.incorrectPattern,
      correctPattern: t.correctPattern
    }))
  };
}

function trap(description, incorrectPattern, correctPattern, trapId) {
  return { description, incorrectPattern, correctPattern, trapId };
}

const CATALOG = [
  /* ───────── 중1 ───────── */
  unit('M1_BE_VERB', 'M1', '문장의 기초', 'be동사 긍정·부정·의문',
    ['주어에 맞는 am/is/are, was/were', 'be 부정: be + not / 의문: Be + 주어…?'],
    [
      trap('주어-be 수일치 오류', 'She are happy today.', 'She is happy today.'),
      trap('be + 일반동사 원형', 'He is go to school.', 'He goes to school.')
    ]),
  unit('M1_GENERAL_VERB', 'M1', '문장의 기초', '일반동사 긍정·부정·의문',
    ['3인칭 단수 현재 -(e)s', '부정·의문: do/does + 동사원형'],
    [
      trap('3인칭 -s 누락', 'Tom play soccer every day.', 'Tom plays soccer every day.'),
      trap('does 뒤 -s 유지', 'She does not likes pizza.', 'She does not like pizza.'),
      trap('의문에 do 누락/어순', 'Where you live?', 'Where do you live?')
    ]),
  unit('M1_PROGRESSIVE', 'M1', '시제', '현재진행시제',
    ['be + V-ing', '상태동사(know, like 등)는 보통 진행형 불가'],
    [
      trap('be 뒤 원형', 'They are play basketball now.', 'They are playing basketball now.'),
      trap('상태동사 진행', 'I am knowing the answer.', 'I know the answer.')
    ]),
  unit('M1_SIMPLE_PAST', 'M1', '시제', '과거시제',
    ['규칙 -ed / 불규칙 과거', '부정·의문: did + 동사원형'],
    [
      trap('did 뒤 과거형', 'Did you went there?', 'Did you go there?'),
      trap('과거 -ed 누락', 'Yesterday I visit my aunt.', 'Yesterday I visited my aunt.')
    ]),
  unit('M1_FUTURE_WILL', 'M1', '시제', '미래 will',
    ['will + 동사원형', '부정 will not / won’t'],
    [trap('will + to-V', 'I will to call you tonight.', 'I will call you tonight.')],
    ['will', '미래']),
  unit('M1_FUTURE_GOING_TO', 'M1', '시제', '미래 be going to',
    ['be going to + 동사원형', '계획·예측'],
    [trap('going to 뒤 -ing', 'She is going to visiting Busan.', 'She is going to visit Busan.')],
    ['going to', 'be going to', '미래']),
  unit('M1_MODAL_CAN', 'M1', '조동사', '조동사 can',
    ['can + 동사원형', '능력·허가'],
    [trap('can + to-V', 'You can to swim well.', 'You can swim well.')],
    ['can', '조동사']),
  unit('M1_MODAL_WILL', 'M1', '조동사', '조동사 will',
    ['will + 동사원형', '의지·미래'],
    [trap('will + -ing', 'She will going home.', 'She will go home.')],
    ['will', '조동사']),
  unit('M1_MODAL_MUST', 'M1', '조동사', '조동사 must',
    ['must + 동사원형', 'must not = 금지'],
    [trap('must + to-V', 'You must to wear a seat belt.', 'You must wear a seat belt.')],
    ['must', '조동사']),
  unit('M1_MODAL_SHOULD', 'M1', '조동사', '조동사 should',
    ['should + 동사원형', '조언·의무'],
    [trap('should + to-V', 'You should to study harder.', 'You should study harder.')],
    ['should', '조동사']),
  unit('M1_MODAL_MAY_MIGHT', 'M1', '조동사', '조동사 may / might',
    ['may/might + 동사원형', '허가·추측'],
    [trap('may + to-V', 'It may to rain tomorrow.', 'It may rain tomorrow.')],
    ['may', 'might', '조동사']),
  unit('M1_IMPERATIVE', 'M1', '문장의 종류', '명령문',
    ['동사원형으로 시작', '부정 명령: Don’t + 동사원형'],
    [
      trap('명령문에 to/주어 과잉', 'To open the window, please.', 'Open the window, please.'),
      trap('부정 명령 do not 어순', 'Do not you talk.', 'Don’t talk.')
    ]),
  unit('M1_THERE_BE', 'M1', '문장의 기초', 'There + be동사',
    ['뒤에 오는 명사 수에 따라 is/are', 'There 구문의 의미상 주어는 뒤 명사'],
    [
      trap('There is + 복수', 'There is many books on the desk.', 'There are many books on the desk.')
    ]),
  unit('M1_IMPERSONAL_IT', 'M1', '문장의 기초', '비인칭 주어 it (날씨·시간·거리)',
    ['날씨·시간·요일·거리 등에 비인칭 it', 'This/That으로 대체하지 않음'],
    [
      trap('비인칭 it 대신 this', 'This is cold today.', 'It is cold today.'),
      trap('거리 표현 오류', 'Here is far from school.', 'It is far from school.')
    ]),
  unit('M1_GERUND_BASIC', 'M1', '준동사', '동명사 기초',
    ['V-ing는 명사 역할(주어·목적어)', 'enjoy/finish/mind + V-ing'],
    [
      trap('enjoy + to-V', 'I enjoy to read novels.', 'I enjoy reading novels.'),
      trap('전치사 뒤 원형', 'She is good at play the piano.', 'She is good at playing the piano.')
    ]),
  unit('M1_TO_INF_NOUN', 'M1', '준동사', 'to부정사 명사적 용법',
    ['to-V = 명사 역할(주어·목적어·보어)', 'want/hope/decide + to-V'],
    [
      trap('want + V-ing', 'She wants going home early.', 'She wants to go home early.'),
      trap('to 누락', 'I hope see you again.', 'I hope to see you again.')
    ]),
  unit('M1_TO_INF_ADVERB', 'M1', '준동사', 'to부정사 부사적 용법',
    ['목적·감정의 원인·결과 등 부사적 용법', '… in order to / to-V'],
    [
      trap('목적 to 대신 for -ing (단순화 맥락)', 'I study hard for passing the test.', 'I study hard to pass the test.')
    ]),
  unit('M1_COMPARATIVE', 'M1', '비교', '비교급 (-er / more)',
    ['단기 -er, 장기 more + 형/부', '비교급 + than'],
    [trap('이중 비교', 'This book is more better.', 'This book is better.')],
    ['비교급', 'comparative', '-er', 'more']),
  unit('M1_SUPERLATIVE', 'M1', '비교', '최상급 (-est / most)',
    ['단기 -est, 장기 most', '최상급 앞 the'],
    [trap('최상급 the 누락', 'He is tallest in our class.', 'He is the tallest in our class.')],
    ['최상급', 'superlative', '-est', 'most']),
  unit('M1_SENSORY_VERB', 'M1', '동사구', '감각동사 (look/sound/feel/smell/taste + 형)',
    ['감각동사 + 형용사 (부사 아님)', 'look happy / sound good'],
    [
      trap('감각동사 + 부사', 'She looks happily today.', 'She looks happy today.'),
      trap('feel + 명사만으로 상태 오류', 'The soup tastes well.', 'The soup tastes good.')
    ]),
  unit('M1_CONJ_WHEN', 'M1', '접속사', '접속사 when',
    ['when + 주어 + 동사', '시간절에서 will 대신 현재'],
    [trap('when 절 will', 'I will call you when I will arrive.', 'I will call you when I arrive.')],
    ['when', '접속사']),
  unit('M1_CONJ_AFTER', 'M1', '접속사', '접속사 after',
    ['after + 절 / after + V-ing', '시간 선후'],
    [trap('after + 원형만', 'After finish homework, I played.', 'After I finished homework, I played.')],
    ['after', '접속사']),
  unit('M1_CONJ_BEFORE', 'M1', '접속사', '접속사 before',
    ['before + 절 / before + V-ing'],
    [trap('before 절 will', 'Finish it before you will leave.', 'Finish it before you leave.')],
    ['before', '접속사']),
  unit('M1_CONJ_THAT', 'M1', '접속사', '접속사 that (명사절)',
    ['동사/형용사 뒤 that + 절', 'that 생략 가능한 경우 있음'],
    [
      trap('that 절 어순 도치', 'I think that is she right.', 'I think that she is right.')
    ]),
  unit('M1_DITRANSITIVE', 'M1', '문장 형식', '4형식 수여동사 (give/send/buy…)',
    ['S + V + IO + DO', 'S + V + DO + to/for + IO 전환'],
    [
      trap('전치사 오류 to/for', 'She bought a gift to me.', 'She bought a gift for me.'),
      trap('간·직목 어순', 'He gave a book me.', 'He gave me a book.')
    ]),
  unit('M1_REFLEXIVE', 'M1', '대명사', '재귀대명사',
    ['myself/yourself/himself…', '주어와 동일 대상 강조·재귀'],
    [
      trap('재귀 형태 오류', 'He hurt hisself.', 'He hurt himself.'),
      trap('일반 목적격 대용 오류', 'I made myself a sandwich. → I made me a sandwich.', 'I made myself a sandwich.')
    ]),
  unit('M1_EXCLAM_WHAT', 'M1', '문장의 종류', '감탄문 What',
    ['What (+a/an) + 형 + 명 (+ S + V)!'],
    [trap('What/How 혼동', 'How a beautiful flower it is!', 'What a beautiful flower it is!')],
    ['what', '감탄문']),
  unit('M1_EXCLAM_HOW', 'M1', '문장의 종류', '감탄문 How',
    ['How + 형/부 (+ S + V)!'],
    [trap('How 어순', 'How beautiful is the day!', 'How beautiful the day is!')],
    ['how', '감탄문']),
  unit('M1_WH_QUESTIONS', 'M1', '의문', '의문사 who/what/where/when/why/how',
    ['의문사 + 조동사/be + 주어…', '주어 의문사는 도치 없음'],
    [
      trap('의문 어순', 'Where he lives?', 'Where does he live?'),
      trap('who 주어에 do 과잉', 'Who did break the window?', 'Who broke the window?')
    ]),
  unit('M1_ARTICLES_NOUNS', 'M1', '명사·관사', '명사와 a/an/the',
    ['단수 가산명사 앞 a/an', '특정·유일 대상 the'],
    [
      trap('모음 앞 a', 'She is a honest student. (발음 기준 an)', 'She is an honest student.'),
      trap('복수/불가산에 a', 'I need a information.', 'I need information. / a piece of information.')
    ]),
  unit('M1_PRONOUNS', 'M1', '대명사', '인칭·소유 대명사',
    ['주격/목적격/소유격/소유대명사 구별', 'my book vs mine'],
    [
      trap('목적격 자리에 주격', 'Please help I.', 'Please help me.'),
      trap('소유대명사 + 명사', 'This is mine book.', 'This is my book. / This is mine.')
    ]),
  unit('M1_PREPOSITIONS_BASIC', 'M1', '전치사', '기초 전치사 (in/on/at/to/for…)',
    ['시간·장소 전치사 기본 용법', '전치사 뒤 목적격/동명사'],
    [
      trap('시간 전치사 혼동', 'I get up on the morning.', 'I get up in the morning.'),
      trap('go + 전치사', 'She goes to home.', 'She goes home.')
    ]),
  unit('M1_ADJ_ADV', 'M1', '형용사·부사', '형용사와 부사',
    ['명사 수식 형용사, 동사 수식 부사', 'very + 형/부'],
    [
      trap('동사 수식에 형용사', 'He runs quick.', 'He runs quickly.'),
      trap('be 보어에 부사', 'She is beautifully.', 'She is beautiful.')
    ]),
  unit('M1_FREQUENCY_ADV', 'M1', '부사', '빈도부사 (always/usually/often…)',
    ['빈도부사는 일반동사 앞, be/조동사 뒤', 'never는 부정 의미'],
    [
      trap('빈도부사 위치', 'She walks always to school.', 'She always walks to school.'),
      trap('be 앞 빈도부사', 'Usually she is late. (허용되나 시험에선 be 뒤를 정답으로 두는 경우 많음)', 'She is usually late.')
    ]),

  /* ───────── 중2 ───────── */
  unit('M2_TO_INF_ADJ', 'M2', '준동사', 'to부정사 형용사적 용법',
    ['명사 뒤에서 명수식: something to eat', 'the first/last + to-V'],
    [
      trap('형용사적 to 누락', 'I need something drink.', 'I need something to drink.'),
      trap('to + -ing', 'He has a lot of work to doing.', 'He has a lot of work to do.')
    ]),
  unit('M2_TO_INF_DUMMY_IT', 'M2', '준동사', '가주어·진주어 it + to-V',
    ['It + be + 형 + to-V', 'This/That을 가주어로 쓰지 않음'],
    [
      trap('가주어 this/that', 'This is easy to solve this problem.', 'It is easy to solve this problem.'),
      trap('to + -ing / to 누락', 'It is important to learning English.', 'It is important to learn English.'),
      trap('for -ing', 'It is easy for finishing early.', 'It is easy to finish early.')
    ]),
  unit('M2_TO_INF_FOR_SB', 'M2', '준동사', 'It ~ for 의미상 주어 + to-V',
    ['It + be + 형 + for + 명/대 + to-V', 'of + 사람 (성격 형용사)와 구별'],
    [
      trap('for/of 혼동', 'It is kind for you to help me.', 'It is kind of you to help me.'),
      trap('의미상 주어 전치사 누락', 'It is important him to study.', 'It is important for him to study.')
    ]),
  unit('M2_TO_INF_WH', 'M2', '준동사', '의문사 + to부정사',
    ['what/how/where/when + to-V', '간접의문 대용'],
    [
      trap('의문사 to 뒤 절 어순', 'I don’t know what to should do.', 'I don’t know what to do.'),
      trap('to 누락', 'Tell me how get there.', 'Tell me how to get there.')
    ]),
  unit('M2_TO_INF_OBJECT_COMP', 'M2', '준동사', '5형식: 동사 + 목적어 + to-V',
    ['want/ask/tell/allow + O + to-V', '사역·지각과 구별'],
    [
      trap('to 누락', 'My mom told me clean my room.', 'My mom told me to clean my room.'),
      trap('원형 대신 -ing', 'He asked me helping him.', 'He asked me to help him.')
    ]),
  unit('M2_GERUND', 'M2', '준동사', '동명사 (주어·목적어)',
    ['동명사 주어: V-ing + V', '동명사 목적어 동사 목록'],
    [
      trap('동명사 주어 수일치', 'Playing games are fun.', 'Playing games is fun.'),
      trap('finish + to-V', 'I finished to write the letter.', 'I finished writing the letter.')
    ]),
  unit('M2_TO_VS_GERUND', 'M2', '준동사', 'to부정사 vs 동명사',
    ['want/hope/decide + to-V', 'enjoy/finish/mind/avoid + V-ing', 'stop to-V / stop V-ing 구별'],
    [
      trap('동사 패턴 혼동', 'She decided quitting the club.', 'She decided to quit the club.'),
      trap('stop 의미 혼동 문장', 'He stopped to smoke. (의미 차이 주의)', 'He stopped smoking. (= 금연)')
    ]),
  unit('M2_MAKE_ADJ', 'M2', '문장 형식', 'make + 목적어 + 형용사',
    ['make + O + 형용사(보어)', '부사 사용 불가'],
    [
      trap('make O + 부사', 'The news made me sadly.', 'The news made me sad.'),
      trap('be 과잉', 'It made me be happy.', 'It made me happy.')
    ]),
  unit('M2_CALL_AB', 'M2', '문장 형식', '5형식 call A B / name A B',
    ['call/name/elect + O + 명사 보어', '전치사 as 불필요(기본)'],
    [
      trap('call as', 'We call him as Tom.', 'We call him Tom.'),
      trap('보어 형용사 오류 맥락', 'They named the baby is Mina.', 'They named the baby Mina.')
    ]),
  unit('M2_CAUSATIVE_MAKE', 'M2', '동사구', '사역동사 make + O + 원형',
    ['make + O + 동사원형', '수동: be made to-V'],
    [
      trap('make + to-V', 'She made me to cry.', 'She made me cry.'),
      trap('수동 to 누락', 'I was made clean the room.', 'I was made to clean the room.')
    ],
    ['make', '사역동사']),
  unit('M2_CAUSATIVE_HAVE', 'M2', '동사구', '사역동사 have + O + 원형',
    ['have + O + 동사원형', '시킴·부탁'],
    [trap('have + to-V', 'I had him to fix the bike.', 'I had him fix the bike.')],
    ['have', '사역동사']),
  unit('M2_CAUSATIVE_LET', 'M2', '동사구', '사역동사 let + O + 원형',
    ['let + O + 동사원형', '허락'],
    [trap('let + -ing', 'Let him going first.', 'Let him go first.')],
    ['let', '사역동사']),
  unit('M2_PERCEPTION_VERBS', 'M2', '동사구', '지각동사 see/hear + O + 원형/-ing',
    ['see/hear/watch + O + 원형(전체) 또는 -ing(진행)', 'to-V 불가'],
    [
      trap('지각 + to-V', 'I saw him to cross the street.', 'I saw him cross the street.'),
      trap('지각 + that 절만으로 대체 오류 문장', 'I heard she singing.', 'I heard her singing.')
    ]),
  unit('M2_PASSIVE', 'M2', '태', '수동태 (be + p.p.)',
    ['be + p.p.', '시제에 맞는 be', 'by + 행위자'],
    [
      trap('be + 원형', 'The window was break yesterday.', 'The window was broken yesterday.'),
      trap('능동 목적어 잔존', 'The letter was written it by Tom.', 'The letter was written by Tom.')
    ]),
  unit('M2_PRESENT_PERFECT', 'M2', '시제', '현재완료',
    ['have/has + p.p.', '경험·완료·계속', 'ago와 함께 쓰지 않음'],
    [
      trap('현재완료 + ago', 'I have met him two years ago.', 'I met him two years ago.'),
      trap('has/have 수일치', 'She have finished her homework.', 'She has finished her homework.')
    ]),
  unit('M2_USED_TO', 'M2', '시제·조동', 'used to + 동사원형',
    ['used to + 원형 = 과거의 습관/상태', 'be used to + N/-ing 와 구별'],
    [
      trap('used to + -ing', 'I used to playing soccer.', 'I used to play soccer.'),
      trap('be used to 혼동', 'I am used to get up early. (익숙)', 'I am used to getting up early.')
    ]),
  unit('M2_HAVE_TO', 'M2', '조동사', 'have to',
    ['have/has to + 원형', 'don’t have to = 안 해도 됨'],
    [
      trap('have to + to-V 중복', 'I have to to leave now.', 'I have to leave now.'),
      trap('3인칭 has to', 'She have to study more.', 'She has to study more.')
    ],
    ['have to', '조동사']),
  unit('M2_MUST', 'M2', '조동사', 'must',
    ['must + 원형', 'must not = 금지 (don’t have to와 구별)'],
    [trap('must + to-V', 'You must to finish it.', 'You must finish it.')],
    ['must', '조동사']),
  unit('M2_INDIRECT_QUESTION', 'M2', '의문', '간접의문문',
    ['의문사 + 주어 + 동사 (평서 어순)', 'if/whether + 주어 + 동사'],
    [
      trap('간접의문 도치', 'I wonder where does he live.', 'I wonder where he lives.'),
      trap('if 절 do 유지', 'Tell me if did she come.', 'Tell me if she came.')
    ]),
  unit('M2_IF_CONDITION', 'M2', '접속사', '접속사 if (조건절)',
    ['If + 현재, will… (가능 조건)', '조건절에서 will 잘 안 씀'],
    [
      trap('if 절 will', 'If it will rain, we will stay home.', 'If it rains, we will stay home.'),
      trap('주절 시제', 'If you study hard, you pass the test. (조동사 필요 맥락)', 'If you study hard, you will pass the test.')
    ]),
  unit('M2_ALTHOUGH', 'M2', '접속사', '접속사 although / though',
    ['although + 절 (but과 동시 사용 불가)', 'Despite/In spite of + 명사구'],
    [
      trap('although + but', 'Although he was tired, but he worked.', 'Although he was tired, he worked.'),
      trap('although + 명사만', 'Although the rain, we went out.', 'Although it rained, we went out. / Despite the rain…')
    ]),
  unit('M2_BOTH_AND', 'M2', '접속사', '상관접속사 both A and B',
    ['both A and B → 복수 동사'],
    [
      trap('both and 단수 동사', 'Both Tom and Jane is here.', 'Both Tom and Jane are here.'),
      trap('형태 오류', 'Both of Tom and Jane like music.', 'Both Tom and Jane like music.')
    ],
    ['both', 'and', '상관접속사']),
  unit('M2_EITHER_OR', 'M2', '접속사', '상관접속사 either A or B',
    ['either A or B', '동사는 or 뒤 주어에 일치'],
    [trap('either or 수일치', 'Either the students or the teacher are late.', 'Either the students or the teacher is late.')],
    ['either', 'or', '상관접속사']),
  unit('M2_NEITHER_NOR', 'M2', '접속사', '상관접속사 neither A nor B',
    ['neither A nor B', '동사는 nor 뒤 주어에 일치'],
    [trap('neither nor 수일치', 'Neither Tom nor his friends is coming. (friends에 맞춤)', 'Neither Tom nor his friends are coming.')],
    ['neither', 'nor', '상관접속사']),
  unit('M2_REL_WHO', 'M2', '관계사', '관계대명사 who (주격)',
    ['사람 선행사 + who + 동사', '주격 who'],
    [
      trap('what + 선행사', 'I have a friend what lives in Busan.', 'I have a friend who lives in Busan.'),
      trap('중복 주어', 'The boy who he won is my cousin.', 'The boy who won is my cousin.')
    ],
    ['who', '관계대명사', '주격']),
  unit('M2_REL_WHICH', 'M2', '관계사', '관계대명사 which',
    ['사물·동물 선행사 + which', '주격/목적격 which'],
    [
      trap('사람에게 which', 'I met a girl which can sing well.', 'I met a girl who can sing well.'),
      trap('중복 목적어', 'This is the book which I bought it.', 'This is the book which I bought.')
    ],
    ['which', '관계대명사']),
  unit('M2_REL_THAT', 'M2', '관계사', '관계대명사 that',
    ['사람·사물 that', '계속적 용법(콤마)에는 that 불가'],
    [
      trap('계속적 that', 'I met Tom, that is my cousin.', 'I met Tom, who is my cousin.'),
      trap('전치사 + that', 'This is the house in that I lived.', 'This is the house in which I lived. / that I lived in.')
    ],
    ['that', '관계대명사']),
  unit('M2_REL_WHOM', 'M2', '관계사', '관계대명사 whom (목적격)',
    ['사람 목적격 whom', '전치사 + whom'],
    [
      trap('주격 자리에 whom', 'The girl whom won is my sister.', 'The girl who won is my sister.'),
      trap('전치사 잔존', 'The man whom I talked is kind.', 'The man whom I talked to is kind. / to whom I talked')
    ],
    ['whom', '관계대명사', '목적격']),
  unit('M2_THE_COMPARATIVE', 'M2', '비교', 'The + 비교급 ~, the + 비교급 …',
    ['The + 비교급 …, the + 비교급 …', '올바른 비교급 형태·어순'],
    [
      trap('more + -er', 'The more faster she runs, the more tired she gets.', 'The faster she runs, the more tired she gets.'),
      trap('어순 도치', 'The harder he works, the more successful becomes he.', 'The harder he works, the more successful he becomes.'),
      trap('비교급 누락', 'The higher I went, the tired I got.', 'The higher I went, the more tired I got.')
    ]),
  unit('M2_AS_AS', 'M2', '비교', 'as + 원급 + as (동등비교)',
    ['as + 원급 형/부 + as', 'not as/so + 원급 + as'],
    [
      trap('as + 비교급', 'She is as taller as her brother.', 'She is as tall as her brother.'),
      trap('as 한 쪽 누락', 'He runs as fast his friend.', 'He runs as fast as his friend.')
    ]),
  unit('M2_COMPARATIVE_EMPHASIS', 'M2', '비교', '비교급 강조 (much/even/a lot…)',
    ['much/even/a lot/far + 비교급', 'very + 비교급 불가'],
    [
      trap('very + 비교급', 'This is very better than that.', 'This is much better than that.'),
      trap('more 중첩', 'She is much more kinder.', 'She is much kinder.')
    ]),
  unit('M2_SO_THAT', 'M2', '구문', 'so ~ that',
    ['so + 형/부 + that'],
    [trap('so + 명사', 'It was so a good movie that I cried.', 'It was such a good movie that I cried.')],
    ['so that', 'so']),
  unit('M2_SUCH_THAT', 'M2', '구문', 'such ~ that',
    ['such + (a/an) + 형 + 명 + that'],
    [trap('such + 형만', 'She was such tired that she slept.', 'She was so tired that she slept.')],
    ['such that', 'such']),
  unit('M2_TOO_TO', 'M2', '구문', 'too ~ to-V',
    ['too + 형/부 + to-V'],
    [trap('too + 명사 직접', 'There are too students.', 'There are too many students.')],
    ['too', 'too to']),
  unit('M2_ENOUGH_TO', 'M2', '구문', 'enough to-V',
    ['형/부 + enough + to-V', 'enough + 명사'],
    [trap('enough 위치', 'He is enough tall to reach it.', 'He is tall enough to reach it.')],
    ['enough']),
  unit('M2_PARTICIPLE_FEELING', 'M2', '준동사', '감정 분사 (-ed / -ing)',
    ['-ing: 감정을 유발하는 쪽', '-ed: 감정을 느끼는 쪽'],
    [
      trap('exciting/excited 혼동', 'I am exciting about the trip.', 'I am excited about the trip.'),
      trap('boring/bored', 'The class was bored.', 'The class was boring. / Students were bored.')
    ]),
  unit('M2_PARTICIPLE_BASIC', 'M2', '준동사', '현재분사·과거분사 기초',
    ['현재분사: 능동/~하는', '과거분사: 수동/~된', '명사 앞 수식'],
    [
      trap('능·수동 혼동', 'Look at the breaking window. (이미 깨진)', 'Look at the broken window.'),
      trap('분사 위치/형태', 'The girl dressing in red is my sister. (수동·상태)', 'The girl dressed in red is my sister.')
    ]),
  unit('M2_IMPERATIVE_AND_OR', 'M2', '문장의 종류', '명령문 + and/or',
    ['명령문, and … = If you…, …', '명령문, or … = If you don’t…, …'],
    [
      trap('접속 의미 혼동 문장', 'Study hard, or you will succeed.', 'Study hard, and you will succeed. / Study hard, or you will fail.')
    ]),
  unit('M2_SUBJECT_VERB_AGREE', 'M2', '일치', '수 일치 (every/each/all…)',
    ['every/each + 단수 동사', 'all + 복수/불가산 수일치', 'either/neither 단수'],
    [
      trap('every + 복수동사', 'Every student have a book.', 'Every student has a book.'),
      trap('each of + are', 'Each of the books are useful.', 'Each of the books is useful.'),
      trap('all the food are', 'All the food are good.', 'All the food is good.')
    ]),
  unit('M2_THING_ADJ', 'M2', '형용사', 'something/anything + 형용사',
    ['-thing/-one/-body 뒤에서 형용사가 후위 수식', 'a interesting thing → something interesting'],
    [
      trap('형용사 전위', 'I want interesting something.', 'I want something interesting.'),
      trap('부정·의문 anything', 'Do you have something cold? (정중·일반 허용, 시험에선 anything)', 'Do you have anything cold?')
    ]),

  /* ───────── 중3 ───────── */
  unit('M3_RELATIVE_WHAT', 'M3', '관계사', '관계대명사 what',
    ['what = the thing(s) which (선행사 포함)', '선행사와 what 동시 사용 불가'],
    [
      trap('선행사 + what', 'I believe the thing what he said.', 'I believe what he said. / the thing that he said.'),
      trap('what 절 동사 수일치', 'What he needs are money. (단수 취급 흔함)', 'What he needs is money.')
    ]),
  unit('M3_REL_WHERE', 'M3', '관계사', '관계부사 where',
    ['장소 선행사 + where', 'in/at which와 전환'],
    [trap('where 대신 which 전치사 누락', 'This is the school which I studied.', 'This is the school where I studied.')],
    ['where', '관계부사']),
  unit('M3_REL_WHEN', 'M3', '관계사', '관계부사 when',
    ['시간 선행사 + when'],
    [trap('when 중복', 'I remember the day when I met him on it.', 'I remember the day when I met him.')],
    ['when', '관계부사']),
  unit('M3_REL_WHY', 'M3', '관계사', '관계부사 why',
    ['the reason why / why 생략'],
    [trap('why + because 중복', 'The reason why he left is because he was tired.', 'The reason why he left is that he was tired.')],
    ['why', '관계부사']),
  unit('M3_REL_HOW', 'M3', '관계사', '관계부사 how',
    ['how = the way (the way how 불가)'],
    [trap('the way how', 'This is the way how he solved it.', 'This is how he solved it. / the way he solved it.')],
    ['how', '관계부사']),
  unit('M3_RELATIVE_CONTINUATIVE', 'M3', '관계사', '관계대명사 계속적 용법',
    [', who/which … (콤마) 계속적 용법', 'that은 계속적 용법에 안 씀'],
    [
      trap('계속적 that', 'I met Tom, that is my cousin.', 'I met Tom, who is my cousin.'),
      trap('콤마 없는 오해 문장 정정', 'My father who lives in Seoul is a teacher. (아버지 한 명 전제 시 콤마)', 'My father, who lives in Seoul, is a teacher.')
    ]),
  unit('M3_PRESENT_PERFECT', 'M3', '시제', '현재완료 심화 (for/since/just/already/yet)',
    ['for + 기간 / since + 시점', 'just/already/yet 위치'],
    [
      trap('for/since 혼동', 'I have lived here since five years.', 'I have lived here for five years.'),
      trap('yet 긍정문', 'I have yet finished.', 'I haven’t finished yet. / I have already finished.')
    ]),
  unit('M3_PERFECT_PROGRESSIVE', 'M3', '시제', '현재완료진행',
    ['have/has been + V-ing', '계속·임시적 동작 강조'],
    [
      trap('been 누락', 'I have studying for two hours.', 'I have been studying for two hours.'),
      trap('상태동사 완료진행', 'I have been knowing her for years.', 'I have known her for years.')
    ]),
  unit('M3_PAST_PERFECT', 'M3', '시제', '과거완료',
    ['had + p.p. (대과거)', 'before/after/by the time과 자주 쓰임'],
    [
      trap('had + 원형', 'He had leave before I arrived.', 'He had left before I arrived.'),
      trap('단순과거만으로 선후 모호한 오류 문장', 'The train left when I arrived. (이미 출발)', 'The train had left when I arrived.')
    ]),
  unit('M3_PASSIVE_ADVANCED', 'M3', '태', '수동태 심화 (조동사·4·5형식)',
    ['조동사 + be + p.p.', '4형식 수동, 5형식 보어 유지'],
    [
      trap('조동사 수동 어순', 'The work must finished today.', 'The work must be finished today.'),
      trap('by 목적격', 'The song was sung by he.', 'The song was sung by him.')
    ]),
  unit('M3_PARTICIPLE_CLAUSE', 'M3', '준동사', '분사구문',
    ['Being/Having 생략 가능한 분사구문', '주어 일치, 수동 being p.p.'],
    [
      trap('주어 불일치', 'Walking along the street, a car hit me.', 'Walking along the street, I was hit by a car. / While I was walking…'),
      trap('완료분사', 'Finishing the work, he has gone home. (선후)', 'Having finished the work, he went home.')
    ]),
  unit('M3_CONDITIONAL', 'M3', '가정', '가정법 과거 (If + 과거, would…)',
    ['If + 과거, would/could + 원형', 'be → were 선호'],
    [
      trap('가정법 will', 'If I were rich, I will buy a house.', 'If I were rich, I would buy a house.'),
      trap('if 절 would', 'If I would be you, I would apologize.', 'If I were you, I would apologize.')
    ]),
  unit('M3_CONDITIONAL_PASTPERF', 'M3', '가정', '가정법 과거완료',
    ['If + had p.p., would have p.p.', '과거 사실의 반대를 가정'],
    [
      trap('시제 혼용', 'If I had studied, I would pass.', 'If I had studied, I would have passed.'),
      trap('had 누락', 'If I studied harder, I would have passed. (과거완료 필요 맥락)', 'If I had studied harder, I would have passed.')
    ]),
  unit('M3_I_WISH', 'M3', '가정', 'I wish + 가정법',
    ['wish + 과거 = 현재 유감', 'wish + had p.p. = 과거 유감'],
    [
      trap('wish + will/현재', 'I wish I am taller.', 'I wish I were taller.'),
      trap('wish 과거완료', 'I wish I studied harder yesterday.', 'I wish I had studied harder yesterday.')
    ]),
  unit('M3_SHOULD_HAVE', 'M3', '조동사', 'should have + p.p.',
    ['should have p.p. = …했어야 했는데'],
    [trap('should have + 원형', 'You should have study harder.', 'You should have studied harder.')],
    ['should have', 'should', '조동사', '완료']),
  unit('M3_MUST_HAVE', 'M3', '조동사', 'must have + p.p.',
    ['must have p.p. = …했음에 틀림없다'],
    [trap('must have 형태', 'He must be arrived by now.', 'He must have arrived by now.')],
    ['must have', 'must', '조동사', '완료']),
  unit('M3_MAY_HAVE', 'M3', '조동사', 'may/might have + p.p.',
    ['may/might have p.p. = …했을지도 모른다'],
    [trap('may have + 원형', 'She may have go already.', 'She may have gone already.')],
    ['may have', 'might have', 'may', 'might', '조동사', '완료']),
  unit('M3_IT_SEEM_THAT', 'M3', '구문', 'It seems that / S seem to-V',
    ['It seems that + 절', '주어 + seem(s) to-V 전환'],
    [
      trap('seem + V-ing', 'He seems knowing the answer.', 'He seems to know the answer.'),
      trap('It seems + 원형', 'It seems rain today.', 'It seems to rain today. / It seems that it will rain.')
    ]),
  unit('M3_REPORTED_SPEECH', 'M3', '화법', '화법 전환 (직접↔간접)',
    ['시제 후퇴, 대명사·부사 변화', '의문·명령 간접화'],
    [
      trap('시제 후퇴 누락', 'He said he is tired. (발화 과거 맥락)', 'He said he was tired.'),
      trap('간접의문 어순', 'She asked me where was the station.', 'She asked me where the station was.')
    ]),
  unit('M3_AGREEMENT', 'M3', '일치', '시제·주어 일치 심화',
    ['주어 핵에 맞는 동사', '함께/함께 아닌 부가어 무시', 'one of / a number of'],
    [
      trap('with 삽입 복수', 'The teacher with students are here.', 'The teacher with students is here.'),
      trap('one of + 단수명사', 'He is one of the best student.', 'He is one of the best students.')
    ]),
  unit('M3_SUBJUNCTIVE_DEMAND', 'M3', '가정', '요구·제안 that + (should) 원형',
    ['suggest/insist/demand that + 주어 + 동사원형', 'should 생략형'],
    [
      trap('that 절 3인칭 -s', 'She suggested that he studies more.', 'She suggested that he study more.'),
      trap('to-V로 대체 오류 문장', 'They insisted to leave at once.', 'They insisted that we leave at once. / insisted on leaving')
    ]),
  unit('M3_RELATIVE_OMISSION', 'M3', '관계사', '관계대명사 생략·전치사',
    ['목적격 생략', '전치사 + whom/which (that 불가)'],
    [
      trap('전치사 + that', 'This is the house in that I lived.', 'This is the house in which I lived. / that I lived in.'),
      trap('생략 후 잔존 대명사', 'The movie I saw it was fun.', 'The movie I saw was fun.')
    ]),
  unit('M3_COMPLEX_CONNECTIVES', 'M3', '접속사', '복합·상관 접속 (not only…but also / whether…)',
    ['not only A but also B 수일치', 'whether A or B'],
    [
      trap('not only 도치/수일치', 'Not only he but also I is happy. (동사는 가까운 주어)', 'Not only he but also I am happy.'),
      trap('whether or not', 'I don’t know whether will he come.', 'I don’t know whether he will come.')
    ]),
  unit('M3_MODAL_PERFECT_PASSIVE', 'M3', '태·조동', '조동사 완료·수동 결합',
    ['조동사 + have been + p.p.', 'should have been done'],
    [
      trap('어순', 'The work should been finished.', 'The work should have been finished.'),
      trap('been 누락', 'It must have done already.', 'It must have been done already.')
    ]),
  unit('M3_INVERSION_BASIC', 'M3', '특수구문', '부정어 도치 (Never/Seldom…)',
    ['Never/Seldom/Little + 조동사 + 주어', 'Only after… 도치'],
    [
      trap('도치 누락', 'Never I have seen such a view.', 'Never have I seen such a view.'),
      trap('잘못된 도치', 'Never I saw him again.', 'Never did I see him again. / Never have I seen…')
    ]),
  unit('M3_EMPHASIS_IT_CLEFT', 'M3', '특수구문', 'It is ~ that 강조구문',
    ['It is/was + 강조부분 + that/who…', '가주어 it 구문과 구별'],
    [
      trap('what 강조 혼동', 'It was Tom what broke the vase.', 'It was Tom that/who broke the vase.'),
      trap('시제', 'It is yesterday that I met her.', 'It was yesterday that I met her.')
    ])
];

function listCatalog(filters) {
  filters = filters || {};
  let rows = CATALOG.slice();
  if (filters.grade) {
    const g = String(filters.grade).toUpperCase();
    rows = rows.filter((r) => r.grade === g);
  }
  if (filters.category) {
    const cat = String(filters.category).trim();
    rows = rows.filter((r) => r.category === cat);
  }
  if (filters.q) {
    const q = String(filters.q).toLowerCase().trim();
    rows = rows.filter((r) => {
      // Labels/keywords only — trap/coreRules prose often mentions related
      // forms (e.g. which inside a what unit) and should not broaden the pick.
      const hay = [
        r.unitId.replace(/_/g, ' '),
        r.category,
        r.subCategory,
        (r.keywords || []).join(' ')
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  return rows.map((r) => ({
    unitId: r.unitId,
    grade: r.grade,
    category: r.category,
    subCategory: r.subCategory,
    keywords: (r.keywords || []).slice(),
    coreRules: r.coreRules.slice(),
    errorTraps: r.errorTraps.map((t) => ({ ...t })),
    trapCount: r.errorTraps.length
  }));
}

function getUnitsByIds(unitIds) {
  const set = new Set((unitIds || []).map((id) => String(id)));
  return CATALOG.filter((r) => set.has(r.unitId)).map((r) => ({
    unitId: r.unitId,
    grade: r.grade,
    category: r.category,
    subCategory: r.subCategory,
    keywords: (r.keywords || []).slice(),
    coreRules: r.coreRules.slice(),
    errorTraps: r.errorTraps.map((t) => ({ ...t }))
  }));
}

function listCategories() {
  const map = {};
  CATALOG.forEach((r) => {
    if (!map[r.category]) map[r.category] = [];
    map[r.category].push(r.unitId);
  });
  return Object.keys(map).map((category) => ({
    category,
    unitIds: map[category],
    count: map[category].length
  }));
}

module.exports = {
  QUESTION_TYPES,
  MVP_TYPES,
  CATALOG,
  listCatalog,
  getUnitsByIds,
  listCategories
};
