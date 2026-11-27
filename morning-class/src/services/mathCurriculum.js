'use strict';

/**
 * Pre-Algebra and Algebra 1 seeds. The teacher page loads these through the API.
 * Learning objectives stay fixed so each workbook is aligned to the same chapter.
 */

const CURRICULA = [
  { id: 'pre-algebra', title: 'Pre-Algebra', gradeBand: '6-8' },
  { id: 'algebra-1', title: 'Algebra 1', gradeBand: '8-9' }
];

const CURRICULUM = CURRICULA[0];

function level(id) {
  return CURRICULA.find((item) => item.id === id) || CURRICULA[0];
}

function ch(partial) {
  const curriculum = level('pre-algebra');
  return Object.assign({
    curriculumId: curriculum.id,
    curriculumTitle: curriculum.title,
    gradeBand: curriculum.gradeBand
  }, partial);
}

function a1(partial) {
  const curriculum = level('algebra-1');
  return Object.assign({
    curriculumId: curriculum.id,
    curriculumTitle: curriculum.title,
    gradeBand: curriculum.gradeBand
  }, partial);
}

const CHAPTERS = [
  ch({
    id: 'pa-c01', number: 1, unitId: 'u1', unitTitle: 'Number Sense and Operations',
    title: 'Whole Numbers and Order of Operations',
    checkMode: 'numeric',
    description: 'Operations on whole numbers and the order of operations.',
    prerequisites: ['Place value', 'Basic counting'],
    objectives: [
      { id: 'pa-c01-o1', text: 'Add, subtract, multiply, and divide whole numbers.' },
      { id: 'pa-c01-o2', text: 'Apply the order of operations, including parentheses and exponents.' },
      { id: 'pa-c01-o3', text: 'Estimate and check whether a whole-number result is reasonable.' }
    ]
  }),
  ch({
    id: 'pa-c02', number: 2, unitId: 'u1', unitTitle: 'Number Sense and Operations',
    title: 'Fractions',
    checkMode: 'numeric',
    description: 'Fraction meaning, equivalence, and the four operations.',
    prerequisites: ['Whole-number operations'],
    objectives: [
      { id: 'pa-c02-o1', text: 'Find equivalent fractions and simplify fractions.' },
      { id: 'pa-c02-o2', text: 'Add and subtract fractions and mixed numbers.' },
      { id: 'pa-c02-o3', text: 'Multiply and divide fractions and mixed numbers.' }
    ]
  }),
  ch({
    id: 'pa-c03', number: 3, unitId: 'u1', unitTitle: 'Number Sense and Operations',
    title: 'Decimals',
    checkMode: 'numeric',
    description: 'Decimal place value and operations, including links to fractions.',
    prerequisites: ['Place value', 'Fraction operations'],
    objectives: [
      { id: 'pa-c03-o1', text: 'Read, write, and compare decimals.' },
      { id: 'pa-c03-o2', text: 'Add, subtract, multiply, and divide decimals.' },
      { id: 'pa-c03-o3', text: 'Convert between simple decimals and fractions.' }
    ]
  }),
  ch({
    id: 'pa-c04', number: 4, unitId: 'u2', unitTitle: 'Ratios and Proportional Reasoning',
    title: 'Ratios and Rates',
    checkMode: 'numeric',
    description: 'Ratio language, equivalent ratios, and unit rates.',
    prerequisites: ['Fraction meaning', 'Division'],
    objectives: [
      { id: 'pa-c04-o1', text: 'Write and simplify ratios.' },
      { id: 'pa-c04-o2', text: 'Find equivalent ratios.' },
      { id: 'pa-c04-o3', text: 'Compute unit rates.' }
    ]
  }),
  ch({
    id: 'pa-c05', number: 5, unitId: 'u2', unitTitle: 'Ratios and Proportional Reasoning',
    title: 'Proportions and Percentages',
    checkMode: 'numeric',
    description: 'Solve proportions and percent problems that reduce to arithmetic.',
    prerequisites: ['Ratios', 'Decimal operations'],
    objectives: [
      { id: 'pa-c05-o1', text: 'Solve a proportion for a missing number.' },
      { id: 'pa-c05-o2', text: 'Find a percent of a number, and a number from a percent.' },
      { id: 'pa-c05-o3', text: 'Increase or decrease a number by a given percent.' }
    ]
  }),
  ch({
    id: 'pa-c06', number: 6, unitId: 'u3', unitTitle: 'The Number System',
    title: 'Integers and Absolute Value',
    checkMode: 'numeric',
    description: 'Signed numbers, absolute value, and integer operations.',
    prerequisites: ['Whole-number operations'],
    objectives: [
      { id: 'pa-c06-o1', text: 'Compare integers and find absolute value.' },
      { id: 'pa-c06-o2', text: 'Add and subtract integers.' },
      { id: 'pa-c06-o3', text: 'Multiply and divide integers.' }
    ]
  }),
  ch({
    id: 'pa-c07', number: 7, unitId: 'u4', unitTitle: 'Introduction to Algebra',
    title: 'Variables and Algebraic Expressions',
    checkMode: 'expression',
    description: 'Evaluate expressions by substituting a number for the variable.',
    prerequisites: ['Order of operations', 'Integers'],
    objectives: [
      { id: 'pa-c07-o1', text: 'Translate a short phrase into an expression.' },
      { id: 'pa-c07-o2', text: 'Evaluate an expression for a given value of the variable.' },
      { id: 'pa-c07-o3', text: 'Tell constants, variables, and coefficients apart.' }
    ]
  }),
  ch({
    id: 'pa-c08', number: 8, unitId: 'u4', unitTitle: 'Introduction to Algebra',
    title: 'Simplifying Algebraic Expressions',
    checkMode: 'expression',
    description: 'Combine like terms and use the distributive property. Numeric checks only when a value is given.',
    prerequisites: ['Evaluating expressions'],
    objectives: [
      { id: 'pa-c08-o1', text: 'Identify like terms.' },
      { id: 'pa-c08-o2', text: 'Combine like terms.' },
      { id: 'pa-c08-o3', text: 'Apply the distributive property.' }
    ]
  }),
  ch({
    id: 'pa-c09', number: 9, unitId: 'u4', unitTitle: 'Introduction to Algebra',
    title: 'Solving One-Step Equations',
    checkMode: 'equation',
    description: 'Solve equations that need one inverse operation.',
    prerequisites: ['Integer operations', 'Evaluating expressions'],
    objectives: [
      { id: 'pa-c09-o1', text: 'Solve one-step addition and subtraction equations.' },
      { id: 'pa-c09-o2', text: 'Solve one-step multiplication and division equations.' },
      { id: 'pa-c09-o3', text: 'Check a solution by substitution.' }
    ]
  }),
  ch({
    id: 'pa-c10', number: 10, unitId: 'u4', unitTitle: 'Introduction to Algebra',
    title: 'Solving Two-Step Equations',
    checkMode: 'equation',
    description: 'Solve equations of the form ax + b = c.',
    prerequisites: ['One-step equations'],
    objectives: [
      { id: 'pa-c10-o1', text: 'Undo addition or subtraction, then multiplication or division.' },
      { id: 'pa-c10-o2', text: 'Solve two-step equations with integers and simple fractions.' },
      { id: 'pa-c10-o3', text: 'Check a solution by substitution.' }
    ]
  }),
  ch({
    id: 'pa-c11', number: 11, unitId: 'u5', unitTitle: 'Mathematical Applications',
    title: 'Coordinate Plane and Graphing',
    checkMode: 'mixed',
    description: 'Plot and read points. Numeric questions cover coordinates and simple distances on a grid line.',
    prerequisites: ['Integers'],
    objectives: [
      { id: 'pa-c11-o1', text: 'Name the quadrants and the axes.' },
      { id: 'pa-c11-o2', text: 'Plot and read an ordered pair.' },
      { id: 'pa-c11-o3', text: 'Find a horizontal or vertical distance between two points.' }
    ]
  }),
  ch({
    id: 'pa-c12', number: 12, unitId: 'u5', unitTitle: 'Mathematical Applications',
    title: 'Real-World Algebraic Problem Solving',
    checkMode: 'mixed',
    description: 'Turn a short situation into an expression or a two-step equation.',
    prerequisites: ['Two-step equations', 'Percent'],
    objectives: [
      { id: 'pa-c12-o1', text: 'Define a variable for an unknown in a word problem.' },
      { id: 'pa-c12-o2', text: 'Write and solve a one- or two-step equation from a situation.' },
      { id: 'pa-c12-o3', text: 'Interpret the number in the original situation.' }
    ]
  }),
  ch({
    id: 'pa-c13', number: 13, unitId: 'u5', unitTitle: 'Mathematical Applications',
    title: 'Comprehensive Review and Mastery Assessment',
    checkMode: 'mixed',
    description: 'Mixed review of number operations, percent, integers, and linear equations.',
    prerequisites: ['Chapters 1 through 12'],
    objectives: [
      { id: 'pa-c13-o1', text: 'Choose the right operation or equation for a mixed problem.' },
      { id: 'pa-c13-o2', text: 'Compute accurately with fractions, decimals, integers, and percent.' },
      { id: 'pa-c13-o3', text: 'Solve and check a two-step equation.' }
    ]
  }),
  a1({
    id: 'a1-c01', number: 1, unitId: 'a1', unitTitle: 'Linear Expressions',
    title: 'Evaluating Expressions',
    checkMode: 'numeric',
    description: 'Substitute a number and evaluate using the order of operations.',
    prerequisites: ['Order of operations', 'Integers'],
    objectives: [
      { id: 'a1-c01-o1', text: 'Substitute a given value for a variable.' },
      { id: 'a1-c01-o2', text: 'Evaluate a numeric expression that includes parentheses and exponents.' },
      { id: 'a1-c01-o3', text: 'Check a substituted result with the order of operations.' }
    ]
  }),
  a1({
    id: 'a1-c02', number: 2, unitId: 'a1', unitTitle: 'Linear Expressions',
    title: 'Simplifying Linear Expressions',
    checkMode: 'expression',
    description: 'Distribute and combine like terms in expressions that stay linear in x.',
    prerequisites: ['Like terms', 'Distributive property'],
    objectives: [
      { id: 'a1-c02-o1', text: 'Apply the distributive property.' },
      { id: 'a1-c02-o2', text: 'Combine like terms, including subtraction.' },
      { id: 'a1-c02-o3', text: 'Simplify an expression to the form ax+b.' }
    ]
  }),
  a1({
    id: 'a1-c03', number: 3, unitId: 'a2', unitTitle: 'Linear Equations',
    title: 'Two-Step Equations',
    checkMode: 'equation',
    description: 'Solve two-step equations in one variable.',
    prerequisites: ['One-step equations', 'Integers'],
    objectives: [
      { id: 'a1-c03-o1', text: 'Undo multiplication or division after addition or subtraction.' },
      { id: 'a1-c03-o2', text: 'Solve two-step equations that include integers and simple fractions.' },
      { id: 'a1-c03-o3', text: 'Check a solution by substitution.' }
    ]
  }),
  a1({
    id: 'a1-c04', number: 4, unitId: 'a2', unitTitle: 'Linear Equations',
    title: 'Multi-Step Equations',
    checkMode: 'equation',
    description: 'Simplify both sides, then solve a linear equation.',
    prerequisites: ['Distributive property', 'Two-step equations'],
    objectives: [
      { id: 'a1-c04-o1', text: 'Simplify one side before solving.' },
      { id: 'a1-c04-o2', text: 'Use the distributive property inside an equation.' },
      { id: 'a1-c04-o3', text: 'Check a solution by substitution.' }
    ]
  }),
  a1({
    id: 'a1-c05', number: 5, unitId: 'a2', unitTitle: 'Linear Equations',
    title: 'Variables on Both Sides',
    checkMode: 'equation',
    description: 'Solve linear equations that have the variable on both sides.',
    prerequisites: ['Multi-step equations'],
    objectives: [
      { id: 'a1-c05-o1', text: 'Move variable terms to one side.' },
      { id: 'a1-c05-o2', text: 'Solve an equation of the form ax+b=cx+d.' },
      { id: 'a1-c05-o3', text: 'Check a solution by substitution.' }
    ]
  }),
  a1({
    id: 'a1-c06', number: 6, unitId: 'a3', unitTitle: 'Rates and Exponents',
    title: 'Proportions and Percent',
    checkMode: 'numeric',
    description: 'Solve proportion and percent problems that reduce to arithmetic.',
    prerequisites: ['Ratios', 'Decimal operations'],
    objectives: [
      { id: 'a1-c06-o1', text: 'Solve a proportion for the missing number.' },
      { id: 'a1-c06-o2', text: 'Find a percent of a number and the whole from a percent.' },
      { id: 'a1-c06-o3', text: 'Increase or decrease a quantity by a percent.' }
    ]
  }),
  a1({
    id: 'a1-c07', number: 7, unitId: 'a3', unitTitle: 'Rates and Exponents',
    title: 'Integer Exponents',
    checkMode: 'numeric',
    description: 'Multiply and divide powers of the same base, and evaluate simple powers.',
    prerequisites: ['Multiplication', 'Fractions'],
    objectives: [
      { id: 'a1-c07-o1', text: 'Evaluate a power with a positive or zero exponent.' },
      { id: 'a1-c07-o2', text: 'Multiply and divide powers of the same base.' },
      { id: 'a1-c07-o3', text: 'Evaluate a negative exponent as a unit fraction.' }
    ]
  }),
  a1({
    id: 'a1-c08', number: 8, unitId: 'a4', unitTitle: 'Linear Models',
    title: 'Slope',
    checkMode: 'numeric',
    description: 'Find slope from two points or from rise and run.',
    prerequisites: ['Integers', 'Division'],
    objectives: [
      { id: 'a1-c08-o1', text: 'Compute rise over run from two points.' },
      { id: 'a1-c08-o2', text: 'Tell whether a slope is positive, negative, zero, or undefined as a number when it exists.' },
      { id: 'a1-c08-o3', text: 'Find the missing coordinate when the slope is given.' }
    ]
  }),
  a1({
    id: 'a1-c09', number: 9, unitId: 'a4', unitTitle: 'Linear Models',
    title: 'Slope-Intercept Form',
    checkMode: 'mixed',
    description: 'Read slope and intercept, and evaluate a line at a given x.',
    prerequisites: ['Slope', 'Evaluating expressions'],
    objectives: [
      { id: 'a1-c09-o1', text: 'Identify the slope and y-intercept of y=mx+b.' },
      { id: 'a1-c09-o2', text: 'Evaluate a line at a given x.' },
      { id: 'a1-c09-o3', text: 'Write a numeric check for a point on the line.' }
    ]
  }),
  a1({
    id: 'a1-c10', number: 10, unitId: 'a4', unitTitle: 'Linear Models',
    title: 'Real-World Linear Equations',
    checkMode: 'equation',
    description: 'Write and solve a linear equation from a rate or total.',
    prerequisites: ['Multi-step equations', 'Percent'],
    objectives: [
      { id: 'a1-c10-o1', text: 'Define a variable for an unknown quantity.' },
      { id: 'a1-c10-o2', text: 'Write and solve a linear equation from a situation.' },
      { id: 'a1-c10-o3', text: 'Interpret the solution in the original situation.' }
    ]
  })
];

function listCurricula() {
  return CURRICULA.map((item) => Object.assign({}, item));
}

function listChapters() {
  return CHAPTERS.map((c) => Object.assign({}, c, {
    objectives: c.objectives.map((o) => Object.assign({}, o))
  }));
}

function getChapter(id) {
  const found = CHAPTERS.find((c) => c.id === String(id || ''));
  if (!found) return null;
  return listChapters().find((c) => c.id === found.id) || null;
}

module.exports = {
  CURRICULA,
  CURRICULUM,
  CHAPTERS,
  listCurricula,
  listChapters,
  getChapter
};
