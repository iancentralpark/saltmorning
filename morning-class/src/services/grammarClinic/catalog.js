'use strict';

/**
 * Korean middle-school English grammar catalog (내신 문법 포인트).
 * Each entry is a GrammarRuleSpec used to drive exam generation.
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

const MVP_TYPES = [
  'SENTENCE_AUTHENTICITY_SINGLE',
  'SENTENCE_AUTHENTICITY_MULTIPLE',
  'SENTENCE_AUTHENTICITY_COMBINED',
  'UNDERLINE_CORRECTION',
  'BLANK_COMPLETION',
  'SENTENCE_TRANSFORM',
  'DESCRIPTIVE_CORRECTION',
  'ORDERING_WITH_CONDITIONS',
  'FULL_SENTENCE_COMPOSITION'
];

const CATALOG = [
  {
    unitId: 'M1_BE_VERB',
    grade: 'M1',
    category: '문장의 기초',
    subCategory: 'be동사 현재/과거',
    coreRules: [
      '주어에 맞는 be동사: am/is/are, was/were',
      '일반동사와 be동사를 함께 쓰지 않는다'
    ],
    errorTraps: [
      {
        trapId: 'be_sva',
        description: '주어-be 수일치 오류',
        incorrectPattern: 'She are happy today.',
        correctPattern: 'She is happy today.'
      },
      {
        trapId: 'be_with_verb',
        description: 'be + 일반동사 원형 잘못 결합',
        incorrectPattern: 'He is go to school.',
        correctPattern: 'He goes to school.'
      }
    ]
  },
  {
    unitId: 'M1_SIMPLE_PRESENT',
    grade: 'M1',
    category: '시제',
    subCategory: '현재시제 / 3인칭 단수',
    coreRules: [
      '3인칭 단수 주어 + 동사에 -(e)s',
      '부정: do/does not + 동사원형'
    ],
    errorTraps: [
      {
        trapId: '3sg_s',
        description: '3인칭 단수 -s 누락/과잉',
        incorrectPattern: 'Tom play soccer every day.',
        correctPattern: 'Tom plays soccer every day.'
      },
      {
        trapId: 'does_base',
        description: 'does 뒤에서 동사에 -s 유지',
        incorrectPattern: 'She does not likes pizza.',
        correctPattern: 'She does not like pizza.'
      }
    ]
  },
  {
    unitId: 'M1_SIMPLE_PAST',
    grade: 'M1',
    category: '시제',
    subCategory: '과거시제',
    coreRules: [
      '규칙동사: -ed / 불규칙 과거형',
      '부정·의문: did + 동사원형'
    ],
    errorTraps: [
      {
        trapId: 'did_past',
        description: 'did 뒤에서 과거형 유지',
        incorrectPattern: 'Did you went there?',
        correctPattern: 'Did you go there?'
      }
    ]
  },
  {
    unitId: 'M1_PROGRESSIVE',
    grade: 'M1',
    category: '시제',
    subCategory: '진행형 (be + -ing)',
    coreRules: [
      'be + 동사원형-ing',
      '상태동사(know, like 등)는 보통 진행형 불가'
    ],
    errorTraps: [
      {
        trapId: 'prog_base',
        description: 'be 뒤에 원형/과거형',
        incorrectPattern: 'They are play basketball now.',
        correctPattern: 'They are playing basketball now.'
      }
    ]
  },
  {
    unitId: 'M1_MODALS',
    grade: 'M1',
    category: '조동사',
    subCategory: 'can / must / should / will',
    coreRules: [
      '조동사 + 동사원형',
      '조동사 뒤에 to 붙이지 않음'
    ],
    errorTraps: [
      {
        trapId: 'modal_to',
        description: '조동사 + to-V',
        incorrectPattern: 'You should to study harder.',
        correctPattern: 'You should study harder.'
      },
      {
        trapId: 'modal_ing',
        description: '조동사 + -ing',
        incorrectPattern: 'She can swimming well.',
        correctPattern: 'She can swim well.'
      }
    ]
  },
  {
    unitId: 'M1_THERE_BE',
    grade: 'M1',
    category: '문장의 기초',
    subCategory: 'There is/are',
    coreRules: [
      '뒤에 오는 명사의 수에 따라 is/are',
      'There 구문에서 주어는 뒤에 오는 명사'
    ],
    errorTraps: [
      {
        trapId: 'there_sva',
        description: 'There is + 복수명사',
        incorrectPattern: 'There is many books on the desk.',
        correctPattern: 'There are many books on the desk.'
      }
    ]
  },
  {
    unitId: 'M1_COMPARATIVE_BASIC',
    grade: 'M1',
    category: '비교',
    subCategory: '비교급 / 최상급 기초',
    coreRules: [
      '단기: -er / -est, 장기: more / most',
      '비교급 뒤 than, 최상급 앞 the'
    ],
    errorTraps: [
      {
        trapId: 'double_comp',
        description: 'more + -er 이중 비교',
        incorrectPattern: 'This book is more better.',
        correctPattern: 'This book is better.'
      }
    ]
  },
  {
    unitId: 'M2_TO_INF_DUMMY_IT',
    grade: 'M2',
    category: '준동사',
    subCategory: '가주어·진주어 it + to-V',
    coreRules: [
      'It + be + 형용사 + to-V',
      'to-V 자리에 동사원형만 / 동명사 단독 사용 불가(이 구문)',
      'This/That을 가주어로 쓰지 않음'
    ],
    errorTraps: [
      {
        trapId: 'dummy_this',
        description: '가주어 it 대신 this/that',
        incorrectPattern: 'This is easy to solve this problem.',
        correctPattern: 'It is easy to solve this problem.'
      },
      {
        trapId: 'to_base_missing',
        description: 'to 누락 또는 to + -ing',
        incorrectPattern: 'It is important learn English. / It is important to learning English.',
        correctPattern: 'It is important to learn English.'
      },
      {
        trapId: 'for_ing',
        description: 'It is adj for -ing',
        incorrectPattern: 'It is easy for finishing the test early.',
        correctPattern: 'It is easy to finish the test early.'
      }
    ]
  },
  {
    unitId: 'M2_THE_COMPARATIVE',
    grade: 'M2',
    category: '비교',
    subCategory: 'The + 비교급 ~, the + 비교급 …',
    coreRules: [
      'The + 비교급 …, the + 비교급 …',
      '부사/형용사는 올바른 비교급 형태',
      '어순: The + 비교급 + S + V'
    ],
    errorTraps: [
      {
        trapId: 'missing_the',
        description: 'the 누락 또는 more + -er',
        incorrectPattern: 'The more faster she runs, the more tired she gets.',
        correctPattern: 'The faster she runs, the more tired she gets.'
      },
      {
        trapId: 'inv_order',
        description: '비교급 절 어순 오류',
        incorrectPattern: 'The harder he works, the more successful becomes he.',
        correctPattern: 'The harder he works, the more successful he becomes.'
      },
      {
        trapId: 'bare_adj',
        description: '두 번째 절 비교급 형태 누락',
        incorrectPattern: 'The higher I went, the tired I got.',
        correctPattern: 'The higher I went, the more tired I got.'
      }
    ]
  },
  {
    unitId: 'M2_INFINITIVE_ROLES',
    grade: 'M2',
    category: '준동사',
    subCategory: 'to부정사 용법 (명사/형/부)',
    coreRules: [
      '명사적: 주어·목적어·보어',
      '형용사적: 명사 수식',
      '부사적: 목적·원인·감정의 원인 등'
    ],
    errorTraps: [
      {
        trapId: 'role_mix',
        description: '용법 설명과 실제 역할 불일치 선지',
        incorrectPattern: 'It is important to learn history. → 목적어라고 설명',
        correctPattern: '진주어(명사적 용법)'
      }
    ]
  },
  {
    unitId: 'M2_GERUND',
    grade: 'M2',
    category: '준동사',
    subCategory: '동명사 (V-ing)',
    coreRules: [
      '동명사는 명사 역할',
      'enjoy, finish, mind, avoid 등은 동명사 목적어',
      '전치사 뒤에는 동명사'
    ],
    errorTraps: [
      {
        trapId: 'enjoy_to',
        description: 'enjoy + to-V',
        incorrectPattern: 'I enjoy to read novels.',
        correctPattern: 'I enjoy reading novels.'
      }
    ]
  },
  {
    unitId: 'M2_TO_VS_GERUND',
    grade: 'M2',
    category: '준동사',
    subCategory: 'to부정사 vs 동명사',
    coreRules: [
      'want/hope/decide + to-V',
      'enjoy/finish/mind + V-ing',
      'stop to-V(멈추고 ~하다) / stop V-ing(~하는 것을 그만두다) 구별'
    ],
    errorTraps: [
      {
        trapId: 'want_ing',
        description: 'want + V-ing',
        incorrectPattern: 'She wants going home early.',
        correctPattern: 'She wants to go home early.'
      }
    ]
  },
  {
    unitId: 'M2_PASSIVE',
    grade: 'M2',
    category: '태',
    subCategory: '수동태',
    coreRules: [
      'be + p.p.',
      '시제에 맞는 be 변화',
      'by + 행위자 (필요 시)'
    ],
    errorTraps: [
      {
        trapId: 'passive_pp',
        description: 'be + 원형/과거형',
        incorrectPattern: 'The window was break by the boy.',
        correctPattern: 'The window was broken by the boy.'
      }
    ]
  },
  {
    unitId: 'M2_INDIRECT_QUESTION',
    grade: 'M2',
    category: '의문',
    subCategory: '간접의문문',
    coreRules: [
      '간접의문: 의문사 + 주어 + 동사 (평서 어순)',
      'Do/Does/Did는 간접의문에서 쓰지 않음(필요 시 시제만 반영)'
    ],
    errorTraps: [
      {
        trapId: 'indir_inv',
        description: '간접의문에서 도치 유지',
        incorrectPattern: 'I wonder where does he live.',
        correctPattern: 'I wonder where he lives.'
      }
    ]
  },
  {
    unitId: 'M2_QUANTIFIERS',
    grade: 'M2',
    category: '수·양',
    subCategory: 'every / each / all / some',
    coreRules: [
      'every/each + 단수명사 + 단수동사',
      'all + 복수/불가산 수일치'
    ],
    errorTraps: [
      {
        trapId: 'every_plural_v',
        description: 'every + 복수동사',
        incorrectPattern: 'Every student have a book.',
        correctPattern: 'Every student has a book.'
      },
      {
        trapId: 'each_of_are',
        description: 'Each of + are',
        incorrectPattern: 'Each of the books are useful.',
        correctPattern: 'Each of the books is useful.'
      }
    ]
  },
  {
    unitId: 'M2_PERCEPTION_VERBS',
    grade: 'M2',
    category: '동사구',
    subCategory: '지각동사 (see/hear + O + V/V-ing)',
    coreRules: [
      'see/hear/watch + 목적어 + 동사원형(전체) 또는 -ing(진행)',
      '목적어 뒤에 to-V 쓰지 않음'
    ],
    errorTraps: [
      {
        trapId: 'see_to',
        description: '지각동사 + to-V',
        incorrectPattern: 'I saw him to cross the street.',
        correctPattern: 'I saw him cross the street.'
      }
    ]
  },
  {
    unitId: 'M3_RELATIVE_PRONOUN',
    grade: 'M3',
    category: '관계사',
    subCategory: '관계대명사 who/which/that',
    coreRules: [
      '사람 who/that, 사물 which/that',
      '주격/목적격 구분, 목적격 생략 가능(제한적)'
    ],
    errorTraps: [
      {
        trapId: 'rel_what',
        description: '선행사 있는데 what 사용',
        incorrectPattern: 'I have a friend what lives in Busan.',
        correctPattern: 'I have a friend who lives in Busan.'
      },
      {
        trapId: 'rel_double',
        description: '관계대명사 + 중복 대명사',
        incorrectPattern: 'This is the book which I bought it yesterday.',
        correctPattern: 'This is the book which I bought yesterday.'
      }
    ]
  },
  {
    unitId: 'M3_RELATIVE_ADVERB',
    grade: 'M3',
    category: '관계사',
    subCategory: '관계부사 where/when/why',
    coreRules: [
      '장소 where, 때 when, 이유 why',
      '전치사+which와 바꿔 쓸 수 있는 경우 주의'
    ],
    errorTraps: [
      {
        trapId: 'where_which',
        description: '장소 선행사에 which만 쓰고 전치사 누락',
        incorrectPattern: 'This is the school which I studied.',
        correctPattern: 'This is the school where I studied.'
      }
    ]
  },
  {
    unitId: 'M3_PRESENT_PERFECT',
    grade: 'M3',
    category: '시제',
    subCategory: '현재완료',
    coreRules: [
      'have/has + p.p.',
      '경험·완료·계속 용법',
      'ago와 함께 쓰지 않음(과거시제 사용)'
    ],
    errorTraps: [
      {
        trapId: 'perf_ago',
        description: '현재완료 + ago',
        incorrectPattern: 'I have met him two years ago.',
        correctPattern: 'I met him two years ago.'
      }
    ]
  },
  {
    unitId: 'M3_CONDITIONAL',
    grade: 'M3',
    category: '가정',
    subCategory: '가정법 과거 (If + 과거, would…)',
    coreRules: [
      'If + 주어 + 과거동사, 주어 + would/could + 동사원형',
      'be동사는 were 선호(격식)'
    ],
    errorTraps: [
      {
        trapId: 'cond_will',
        description: '가정법에서 will 사용',
        incorrectPattern: 'If I were rich, I will buy a house.',
        correctPattern: 'If I were rich, I would buy a house.'
      }
    ]
  },
  {
    unitId: 'M3_PARTICIPLE',
    grade: 'M3',
    category: '준동사',
    subCategory: '분사 (현재분사/과거분사)',
    coreRules: [
      '현재분사: 능동/~하고 있는',
      '과거분사: 수동/~된',
      'interesting vs interested 구별'
    ],
    errorTraps: [
      {
        trapId: 'ed_ing_mix',
        description: '감정분사 -ed/-ing 혼동',
        incorrectPattern: 'I am exciting about the trip.',
        correctPattern: 'I am excited about the trip.'
      }
    ]
  },
  {
    unitId: 'M3_IT_SEEM_THAT',
    grade: 'M3',
    category: '구문',
    subCategory: 'It seems that / S seem to-V',
    coreRules: [
      'It seems that + 절',
      '주어 + seem(s) to-V 전환'
    ],
    errorTraps: [
      {
        trapId: 'seem_ing',
        description: 'seem + V-ing (이 전환 맥락)',
        incorrectPattern: 'He seems knowing the answer.',
        correctPattern: 'He seems to know the answer.'
      }
    ]
  },
  {
    unitId: 'M2_TOO_ENOUGH',
    grade: 'M2',
    category: '구문',
    subCategory: 'too ~ to-V / enough to-V',
    coreRules: [
      'too + 형/부 + to-V',
      '형/부 + enough + to-V',
      'enough는 형용사 뒤, 명사 앞·뒤 가능'
    ],
    errorTraps: [
      {
        trapId: 'enough_order',
        description: 'enough 위치 오류',
        incorrectPattern: 'He is enough tall to reach the shelf.',
        correctPattern: 'He is tall enough to reach the shelf.'
      }
    ]
  },
  {
    unitId: 'M2_SO_SUCH_THAT',
    grade: 'M2',
    category: '구문',
    subCategory: 'so ~ that / such ~ that',
    coreRules: [
      'so + 형/부 + that',
      'such + (a/an) + 형 + 명사 + that'
    ],
    errorTraps: [
      {
        trapId: 'so_noun',
        description: 'so + 명사',
        incorrectPattern: 'It was so a good movie that I cried.',
        correctPattern: 'It was such a good movie that I cried.'
      }
    ]
  }
];

function listCatalog(filters) {
  filters = filters || {};
  let rows = CATALOG.slice();
  if (filters.grade) {
    const g = String(filters.grade).toUpperCase();
    rows = rows.filter((r) => r.grade === g);
  }
  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    rows = rows.filter((r) =>
      (r.unitId + ' ' + r.category + ' ' + r.subCategory).toLowerCase().includes(q)
    );
  }
  return rows.map((r) => ({
    unitId: r.unitId,
    grade: r.grade,
    category: r.category,
    subCategory: r.subCategory,
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
