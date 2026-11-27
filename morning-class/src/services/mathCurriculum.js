'use strict';

/**
 * Pre-Algebra through Algebra 2 seeds. The teacher page loads these through the API.
 * Learning objectives stay fixed so each workbook is aligned to the same chapter.
 */

const CURRICULA = [
  { id: 'pre-algebra', title: 'Pre-Algebra', gradeBand: '6-8' },
  { id: 'algebra-1', title: 'Algebra 1', gradeBand: '8-9' },
  { id: 'geometry', title: 'Geometry', gradeBand: '8-10' },
  { id: 'algebra-2', title: 'Algebra 2', gradeBand: '9-11' }
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

function a2(partial) {
  const curriculum = level('algebra-2');
  return Object.assign({
    curriculumId: curriculum.id,
    curriculumTitle: curriculum.title,
    gradeBand: curriculum.gradeBand
  }, partial);
}

function gm(partial) {
  const curriculum = level('geometry');
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
  }),
  gm({
    id: 'gm-c01', number: 1, unitId: 'g1', unitTitle: 'Points and Angles',
    title: 'Points on the Plane',
    checkMode: 'pair',
    description: 'Name and move ordered pairs, and find a horizontal or vertical distance.',
    prerequisites: ['Integers', 'Coordinate plane'],
    objectives: [
      { id: 'gm-c01-o1', text: 'Read and write an ordered pair.' },
      { id: 'gm-c01-o2', text: 'Translate a point by adding to x or y.' },
      { id: 'gm-c01-o3', text: 'Find the distance between points that share an x- or y-coordinate.' }
    ]
  }),
  gm({
    id: 'gm-c02', number: 2, unitId: 'g1', unitTitle: 'Points and Angles',
    title: 'Angles',
    checkMode: 'numeric',
    description: 'Complementary, supplementary, and vertical angles.',
    prerequisites: ['Addition', 'Subtraction'],
    objectives: [
      { id: 'gm-c02-o1', text: 'Find a complement or a supplement.' },
      { id: 'gm-c02-o2', text: 'Use vertical angles to find an unknown measure.' },
      { id: 'gm-c02-o3', text: 'Add angles around a point to 360 degrees.' }
    ]
  }),
  gm({
    id: 'gm-c03', number: 3, unitId: 'g2', unitTitle: 'Polygons',
    title: 'Triangles',
    checkMode: 'numeric',
    description: 'Triangle angle sum, perimeter, and the third side of a right triangle when it is a whole number.',
    prerequisites: ['Angle measures', 'Perfect squares'],
    objectives: [
      { id: 'gm-c03-o1', text: 'Find a missing angle in a triangle.' },
      { id: 'gm-c03-o2', text: 'Find the perimeter of a triangle.' },
      { id: 'gm-c03-o3', text: 'Find a whole-number side of a right triangle with sqrt of a perfect square.' }
    ]
  }),
  gm({
    id: 'gm-c04', number: 4, unitId: 'g2', unitTitle: 'Polygons',
    title: 'Polygons and Quadrilaterals',
    checkMode: 'numeric',
    description: 'Interior angle sums and perimeters of polygons.',
    prerequisites: ['Triangle angle sum'],
    objectives: [
      { id: 'gm-c04-o1', text: 'Find the interior angle sum of a polygon.' },
      { id: 'gm-c04-o2', text: 'Find a missing angle in a quadrilateral.' },
      { id: 'gm-c04-o3', text: 'Find the perimeter of a rectangle or regular polygon.' }
    ]
  }),
  gm({
    id: 'gm-c05', number: 5, unitId: 'g3', unitTitle: 'Measure',
    title: 'Area',
    checkMode: 'numeric',
    description: 'Areas of rectangles, triangles, and parallelograms.',
    prerequisites: ['Multiplication', 'Fractions'],
    objectives: [
      { id: 'gm-c05-o1', text: 'Find the area of a rectangle or square.' },
      { id: 'gm-c05-o2', text: 'Find the area of a triangle or parallelogram.' },
      { id: 'gm-c05-o3', text: 'Find a missing length when the area is given.' }
    ]
  }),
  gm({
    id: 'gm-c06', number: 6, unitId: 'g3', unitTitle: 'Measure',
    title: 'Circles',
    checkMode: 'numeric',
    description: 'Circumference and area using 3.14 for pi.',
    prerequisites: ['Decimal multiplication'],
    objectives: [
      { id: 'gm-c06-o1', text: 'Find a circumference using 3.14.' },
      { id: 'gm-c06-o2', text: 'Find an area using 3.14.' },
      { id: 'gm-c06-o3', text: 'Find a diameter from a radius, or the reverse.' }
    ]
  }),
  gm({
    id: 'gm-c07', number: 7, unitId: 'g3', unitTitle: 'Measure',
    title: 'Volume and Surface Area',
    checkMode: 'numeric',
    description: 'Rectangular prisms: volume and surface area.',
    prerequisites: ['Area of a rectangle'],
    objectives: [
      { id: 'gm-c07-o1', text: 'Find the volume of a rectangular prism.' },
      { id: 'gm-c07-o2', text: 'Find the surface area of a rectangular prism.' },
      { id: 'gm-c07-o3', text: 'Find a missing edge when the volume is given.' }
    ]
  }),
  gm({
    id: 'gm-c08', number: 8, unitId: 'g4', unitTitle: 'Similarity',
    title: 'Scale Drawings',
    checkMode: 'numeric',
    description: 'Scale factors, corresponding lengths, and areas under a scale.',
    prerequisites: ['Ratios', 'Area'],
    objectives: [
      { id: 'gm-c08-o1', text: 'Find an actual length from a scale.' },
      { id: 'gm-c08-o2', text: 'Find a scale factor from two corresponding lengths.' },
      { id: 'gm-c08-o3', text: 'Find an area scale from a length scale.' }
    ]
  }),
  a2({
    id: 'a2-c01', number: 1, unitId: 'b1', unitTitle: 'Powers and Roots',
    title: 'Integer Exponents',
    checkMode: 'numeric',
    description: 'Products, quotients, and powers of powers, including negative exponents written as fractions.',
    prerequisites: ['Order of operations', 'Fractions'],
    objectives: [
      { id: 'a2-c01-o1', text: 'Multiply and divide powers with the same base.' },
      { id: 'a2-c01-o2', text: 'Apply a power to a power or a product.' },
      { id: 'a2-c01-o3', text: 'Rewrite a negative exponent as a fraction.' }
    ]
  }),
  a2({
    id: 'a2-c02', number: 2, unitId: 'b1', unitTitle: 'Powers and Roots',
    title: 'Simplifying Square Roots',
    checkMode: 'radical',
    description: 'Take square factors out of a radical, and multiply or add like radicals.',
    prerequisites: ['Perfect squares', 'Fractions'],
    objectives: [
      { id: 'a2-c02-o1', text: 'Simplify sqrt(n) by removing the largest perfect-square factor.' },
      { id: 'a2-c02-o2', text: 'Multiply or divide square roots and simplify the result.' },
      { id: 'a2-c02-o3', text: 'Add or subtract like radicals.' }
    ]
  }),
  a2({
    id: 'a2-c03', number: 3, unitId: 'b2', unitTitle: 'Quadratics',
    title: 'Polynomial Operations',
    checkMode: 'quadratic',
    description: 'Add, subtract, and multiply polynomials that stay degree 2 or less.',
    prerequisites: ['Distributive property', 'Like terms'],
    objectives: [
      { id: 'a2-c03-o1', text: 'Add and subtract polynomials in x.' },
      { id: 'a2-c03-o2', text: 'Multiply two binomials.' },
      { id: 'a2-c03-o3', text: 'Square a binomial.' }
    ]
  }),
  a2({
    id: 'a2-c04', number: 4, unitId: 'b2', unitTitle: 'Quadratics',
    title: 'Factoring Quadratics',
    checkMode: 'quadratic',
    description: 'Factor a quadratic into linear factors with integer coefficients.',
    prerequisites: ['Multiplying binomials', 'Greatest common factor'],
    objectives: [
      { id: 'a2-c04-o1', text: 'Factor out a common monomial.' },
      { id: 'a2-c04-o2', text: 'Factor a difference of squares.' },
      { id: 'a2-c04-o3', text: 'Factor a quadratic trinomial into two binomials.' }
    ]
  }),
  a2({
    id: 'a2-c05', number: 5, unitId: 'b2', unitTitle: 'Quadratics',
    title: 'Quadratic Equations',
    checkMode: 'quad',
    description: 'Solve a quadratic equation whose roots are rational.',
    prerequisites: ['Factoring quadratics', 'Zero product property'],
    objectives: [
      { id: 'a2-c05-o1', text: 'Solve a quadratic equation by factoring.' },
      { id: 'a2-c05-o2', text: 'Report both roots when there are two.' },
      { id: 'a2-c05-o3', text: 'Recognize a double root.' }
    ]
  }),
  a2({
    id: 'a2-c06', number: 6, unitId: 'b2', unitTitle: 'Quadratics',
    title: 'Vertex of a Parabola',
    checkMode: 'vertex',
    description: 'Find the vertex of a quadratic written as y = ax^2 + bx + c, or evaluate it after substituting a number.',
    prerequisites: ['Evaluating expressions', 'Fractions'],
    objectives: [
      { id: 'a2-c06-o1', text: 'Find the x-coordinate of the vertex, -b/(2a).' },
      { id: 'a2-c06-o2', text: 'Find the vertex as an ordered pair.' },
      { id: 'a2-c06-o3', text: 'Evaluate a quadratic after substituting a given number.' }
    ]
  }),
  a2({
    id: 'a2-c07', number: 7, unitId: 'b3', unitTitle: 'Systems and Sequences',
    title: 'Systems of Linear Equations',
    checkMode: 'system',
    description: 'Solve a system of two linear equations in x and y.',
    prerequisites: ['Linear equations', 'Ordered pairs'],
    objectives: [
      { id: 'a2-c07-o1', text: 'Solve a system with integer coefficients.' },
      { id: 'a2-c07-o2', text: 'Solve a system that includes a fraction or a negative coefficient.' },
      { id: 'a2-c07-o3', text: 'Write the solution as an ordered pair (x, y).' }
    ]
  }),
  a2({
    id: 'a2-c08', number: 8, unitId: 'b3', unitTitle: 'Systems and Sequences',
    title: 'Sequences',
    checkMode: 'numeric',
    description: 'Arithmetic and geometric sequences with a whole-number index, and a simple exponential change.',
    prerequisites: ['Integer exponents', 'Multiplication'],
    objectives: [
      { id: 'a2-c08-o1', text: 'Find a term of an arithmetic sequence.' },
      { id: 'a2-c08-o2', text: 'Find a term of a geometric sequence.' },
      { id: 'a2-c08-o3', text: 'Evaluate a simple exponential expression such as a start value times an integer power.' }
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
