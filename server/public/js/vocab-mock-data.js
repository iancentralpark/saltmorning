/**
 * Mock vocabulary pack (DB-free first).
 * Schema: layered basic → intermediate → advanced; frequency_level 1–6000.
 * English-only definitions. Seed spans the spectrum for Placement + card demo.
 */
(function (root) {
  'use strict';

  var WORDS = [
    {
      word_id: 1, word: 'happy', part_of_speech: 'adj', frequency_level: 120,
      levels: {
        basic: { intuitive_definition: 'Feeling good inside.', metaphor: 'Like sunshine in your chest.' },
        intermediate: { mechanism_and_nuance: 'Everyday positive mood; softer than “joyful,” less formal than “content.”', examples: ['She felt happy after the game.', 'I’m happy to help.'] },
        advanced: { exceptions: 'In set phrases (“happy to…”) it often means willing, not emotional.', deep_dive: 'Business: “We are happy to confirm…” = polite willingness, not emotion.' }
      }
    },
    {
      word_id: 2, word: 'run', part_of_speech: 'v', frequency_level: 180,
      levels: {
        basic: { intuitive_definition: 'Move fast on your feet.', metaphor: 'Like your legs are racing.' },
        intermediate: { mechanism_and_nuance: 'Also means operate (a machine) or manage (a business).', examples: ['Kids run in the park.', 'They run a small shop.'] },
        advanced: { exceptions: '“Run into” = meet by chance; “run out of” = have none left.', deep_dive: 'Phrasal verbs multiply meaning; tense + particle decide the sense.' }
      }
    },
    {
      word_id: 3, word: 'bright', part_of_speech: 'adj', frequency_level: 450,
      levels: {
        basic: { intuitive_definition: 'Full of light, or smart.', metaphor: 'Like a lightbulb that is on.' },
        intermediate: { mechanism_and_nuance: 'Literal light vs figurative intelligence / hope.', examples: ['Bright sunlight filled the room.', 'She has a bright idea.'] },
        advanced: { exceptions: '“Bright future” is metaphorical hope, not IQ.', deep_dive: 'In academic writing prefer precise alternatives: luminous, intelligent, promising.' }
      }
    },
    {
      word_id: 4, word: 'careful', part_of_speech: 'adj', frequency_level: 620,
      levels: {
        basic: { intuitive_definition: 'Paying attention so nothing goes wrong.', metaphor: 'Walking on eggshells on purpose.' },
        intermediate: { mechanism_and_nuance: 'About caution; “careful with words” means thoughtful speech.', examples: ['Be careful crossing the street.', 'He was careful with the glass.'] },
        advanced: { exceptions: 'Not the same as “caring” (kind). “Careless” is the opposite.', deep_dive: 'Legal/formal tone: “due care,” “with care” = diligence.' }
      }
    },
    {
      word_id: 5, word: 'choose', part_of_speech: 'v', frequency_level: 780,
      levels: {
        basic: { intuitive_definition: 'Pick one thing from options.', metaphor: 'Pointing at one door among many.' },
        intermediate: { mechanism_and_nuance: 'Irregular: choose / chose / chosen. “Select” is more formal.', examples: ['I choose the blue shirt.', 'She chose to stay.'] },
        advanced: { exceptions: '“Choose to + verb” = decide to act; not always from a menu of objects.', deep_dive: 'Nuance vs decide: choose highlights alternatives; decide highlights the decision moment.' }
      }
    },
    {
      word_id: 6, word: 'invite', part_of_speech: 'v', frequency_level: 950,
      levels: {
        basic: { intuitive_definition: 'Ask someone to come or join.', metaphor: 'Opening the door for a guest.' },
        intermediate: { mechanism_and_nuance: 'Social request; “invite criticism” = make something likely (figurative).', examples: ['She invited me to lunch.', 'Don’t invite trouble.'] },
        advanced: { exceptions: 'Passive “be invited” ≠ “be welcome” automatically.', deep_dive: 'Formal RSVP culture: invitation implies response expectation.' }
      }
    },
    {
      word_id: 7, word: 'improve', part_of_speech: 'v', frequency_level: 1100,
      levels: {
        basic: { intuitive_definition: 'Make something better.', metaphor: 'Turning a rough draft into a neat one.' },
        intermediate: { mechanism_and_nuance: 'Progress over time; often with “in / at” skills.', examples: ['Practice will improve your writing.', 'The weather improved.'] },
        advanced: { exceptions: '“Improve on” = do better than a previous version.', deep_dive: 'Business: continuous improvement ≠ one-off fix.' }
      }
    },
    {
      word_id: 8, word: 'decide', part_of_speech: 'v', frequency_level: 1250,
      levels: {
        basic: { intuitive_definition: 'Make a final choice.', metaphor: 'Closing the book on options.' },
        intermediate: { mechanism_and_nuance: '“Decide on/against + noun”; “decide to + verb”.', examples: ['We decided to leave early.', 'He can’t decide.'] },
        advanced: { exceptions: '“Decide” implies resolution; “consider” stops earlier.', deep_dive: 'Judicial tone: decide a case = render a ruling.' }
      }
    },
    {
      word_id: 9, word: 'compare', part_of_speech: 'v', frequency_level: 1400,
      levels: {
        basic: { intuitive_definition: 'Look at how things are similar or different.', metaphor: 'Holding two photos side by side.' },
        intermediate: { mechanism_and_nuance: 'compare A with/to B; “compared to” often introduces contrast.', examples: ['Compare these two answers.', 'Compared to last year, sales rose.'] },
        advanced: { exceptions: '“Compare to” (likeness) vs “compare with” (analysis) — textbooks debate this.', deep_dive: 'Academic: comparison criteria must be explicit to avoid false equivalence.' }
      }
    },
    {
      word_id: 10, word: 'aware', part_of_speech: 'adj', frequency_level: 1550,
      levels: {
        basic: { intuitive_definition: 'Knowing that something exists or is happening.', metaphor: 'Your mental radar is on.' },
        intermediate: { mechanism_and_nuance: 'aware of + noun; “self-aware” = knowing your own habits.', examples: ['Are you aware of the rule?', 'She became aware of the noise.'] },
        advanced: { exceptions: 'Not “know” + object of skill; awareness ≠ mastery.', deep_dive: 'Critical writing: “raising awareness” often means public attention, not deep knowledge.' }
      }
    },
    {
      word_id: 11, word: 'evidence', part_of_speech: 'n', frequency_level: 1750,
      levels: {
        basic: { intuitive_definition: 'Facts that show something is true.', metaphor: 'Clues left on the table.' },
        intermediate: { mechanism_and_nuance: 'Usually uncountable; “pieces of evidence.”', examples: ['There is no evidence yet.', 'The photo is strong evidence.'] },
        advanced: { exceptions: 'Legal “evidence” has procedure rules; everyday talk is looser.', deep_dive: 'Science: evidence supports hypotheses; it rarely “proves” forever.' }
      }
    },
    {
      word_id: 12, word: 'benefit', part_of_speech: 'n', frequency_level: 1900,
      levels: {
        basic: { intuitive_definition: 'A good result you get from something.', metaphor: 'A prize attached to a choice.' },
        intermediate: { mechanism_and_nuance: 'Also a verb: benefit from. “For the benefit of” = to help.', examples: ['Exercise has many benefits.', 'Students benefit from feedback.'] },
        advanced: { exceptions: '“Benefits” at work can mean insurance/perks package.', deep_dive: 'Cost–benefit analysis weighs trade-offs, not only positives.' }
      }
    },
    {
      word_id: 13, word: 'approach', part_of_speech: 'n/v', frequency_level: 2100,
      levels: {
        basic: { intuitive_definition: 'A way of doing something, or to come closer.', metaphor: 'Choosing a path toward a door.' },
        intermediate: { mechanism_and_nuance: 'Method sense (noun) vs physical/metaphorical coming near (verb).', examples: ['Try a new approach.', 'Winter is approaching.'] },
        advanced: { exceptions: '“Approachable” = easy to talk to — person trait, not method.', deep_dive: 'Academic: methodological approach vs theoretical framework.' }
      }
    },
    {
      word_id: 14, word: 'assume', part_of_speech: 'v', frequency_level: 2300,
      levels: {
        basic: { intuitive_definition: 'Believe something without full proof.', metaphor: 'Filling a blank with a guess.' },
        intermediate: { mechanism_and_nuance: 'Can also mean take on a role/duty (“assume responsibility”).', examples: ['Don’t assume she’s angry.', 'He assumed control.'] },
        advanced: { exceptions: '“Assume” ≠ “presume” exactly; presume often implies stronger prior reason.', deep_dive: 'Logic: assumptions must be stated to test an argument.' }
      }
    },
    {
      word_id: 15, word: 'significant', part_of_speech: 'adj', frequency_level: 2500,
      levels: {
        basic: { intuitive_definition: 'Important enough to notice.', metaphor: 'A stone that changes the scale reading.' },
        intermediate: { mechanism_and_nuance: 'Everyday “important” + statistics “unlikely by chance.”', examples: ['A significant change.', 'The result was statistically significant.'] },
        advanced: { exceptions: 'Statistically significant ≠ practically large.', deep_dive: 'Science writing: report effect size with significance.' }
      }
    },
    {
      word_id: 16, word: 'maintain', part_of_speech: 'v', frequency_level: 2700,
      levels: {
        basic: { intuitive_definition: 'Keep something the same or in good condition.', metaphor: 'Holding a balloon so it doesn’t float away.' },
        intermediate: { mechanism_and_nuance: 'Also insist (“maintain that…”).', examples: ['Maintain eye contact.', 'She maintains that she is right.'] },
        advanced: { exceptions: 'Technical: maintain a system = service it; not start it.', deep_dive: 'Policy: maintain order ≠ restore order after collapse.' }
      }
    },
    {
      word_id: 17, word: 'indicate', part_of_speech: 'v', frequency_level: 2900,
      levels: {
        basic: { intuitive_definition: 'Show or point to something.', metaphor: 'An arrow on a sign.' },
        intermediate: { mechanism_and_nuance: 'Neutral reporting verb in essays; softer than “prove.”', examples: ['Surveys indicate a rise.', 'The light indicates power.'] },
        advanced: { exceptions: 'Medical “indicated” = recommended treatment context.', deep_dive: 'Academic hedging: indicate / suggest / demonstrate hierarchy.' }
      }
    },
    {
      word_id: 18, word: 'establish', part_of_speech: 'v', frequency_level: 3100,
      levels: {
        basic: { intuitive_definition: 'Set something up so it exists firmly.', metaphor: 'Planting a flag that stays.' },
        intermediate: { mechanism_and_nuance: 'Create institutions, rules, or prove facts.', examples: ['They established a club.', 'The study established a link.'] },
        advanced: { exceptions: '“Well-established” = long accepted, not newly founded.', deep_dive: 'Legal: establish liability = meet the burden of proof.' }
      }
    },
    {
      word_id: 19, word: 'crucial', part_of_speech: 'adj', frequency_level: 3300,
      levels: {
        basic: { intuitive_definition: 'Extremely important for success.', metaphor: 'The keystone of an arch.' },
        intermediate: { mechanism_and_nuance: 'Stronger than “important”; implies a tipping-point role.', examples: ['Timing is crucial.', 'A crucial decision.'] },
        advanced: { exceptions: 'Avoid stacking with “very” (“very crucial” sounds weak).', deep_dive: 'Rhetoric: overusing crucial drains force — reserve it.' }
      }
    },
    {
      word_id: 20, word: 'analyze', part_of_speech: 'v', frequency_level: 3500,
      levels: {
        basic: { intuitive_definition: 'Break something into parts to understand it.', metaphor: 'Opening a watch to see the gears.' },
        intermediate: { mechanism_and_nuance: 'Academic key verb; UK spelling analyse.', examples: ['Analyze the text.', 'We analyzed the data.'] },
        advanced: { exceptions: 'Analyze ≠ summarize; summary keeps whole, analysis dissects.', deep_dive: 'Methods: qualitative analysis vs quantitative modeling.' }
      }
    },
    {
      word_id: 21, word: 'nevertheless', part_of_speech: 'adv', frequency_level: 3700,
      levels: {
        basic: { intuitive_definition: 'Even so; despite that.', metaphor: 'A bridge across “but.”' },
        intermediate: { mechanism_and_nuance: 'Contrast linker like however; often sentence-initial with comma.', examples: ['It rained. Nevertheless, we played.', 'Hard, nevertheless worth it.'] },
        advanced: { exceptions: 'More formal than “still”; rare in casual speech.', deep_dive: 'Cohesion: nevertheless vs nonetheless nearly synonymous.' }
      }
    },
    {
      word_id: 22, word: 'implication', part_of_speech: 'n', frequency_level: 3900,
      levels: {
        basic: { intuitive_definition: 'A meaning or result that is suggested, not said directly.', metaphor: 'Ripples after a stone drops.' },
        intermediate: { mechanism_and_nuance: 'Logical consequence; “by implication.”', examples: ['What are the implications?', 'Her silence had implications.'] },
        advanced: { exceptions: 'Implication ≠ inference (one is produced, one is drawn).', deep_dive: 'Policy briefs: implications = what decision-makers should notice next.' }
      }
    },
    {
      word_id: 23, word: 'substantial', part_of_speech: 'adj', frequency_level: 4100,
      levels: {
        basic: { intuitive_definition: 'Large in amount or importance.', metaphor: 'A heavy bag, not a feather.' },
        intermediate: { mechanism_and_nuance: 'Quantity/size + seriousness (“substantial evidence”).', examples: ['A substantial increase.', 'Substantial progress.'] },
        advanced: { exceptions: 'Philosophy: “substance” has specialised ontology senses.', deep_dive: 'Finance: substantial ownership thresholds are defined numerically.' }
      }
    },
    {
      word_id: 24, word: 'constitute', part_of_speech: 'v', frequency_level: 4300,
      levels: {
        basic: { intuitive_definition: 'Make up or form something.', metaphor: 'Bricks that are the wall.' },
        intermediate: { mechanism_and_nuance: 'Formal “be” for identity/composition.', examples: ['These form / constitute a team.', 'That constitutes a breach.'] },
        advanced: { exceptions: 'Not everyday speech; prefer “make up” or “is.”', deep_dive: 'Law: “constitutes an offense” = legally qualifies as.' }
      }
    },
    {
      word_id: 25, word: 'discrepancy', part_of_speech: 'n', frequency_level: 4500,
      levels: {
        basic: { intuitive_definition: 'A difference between things that should match.', metaphor: 'Two puzzle pieces that don’t fit.' },
        intermediate: { mechanism_and_nuance: 'Neutral/technical mismatch; often in data/reports.', examples: ['A discrepancy in the totals.', 'Explain the discrepancy.'] },
        advanced: { exceptions: 'Stronger than difference; implies inconsistency needing resolution.', deep_dive: 'Audit language: investigate discrepancies before concluding fraud.' }
      }
    },
    {
      word_id: 26, word: 'ambiguous', part_of_speech: 'adj', frequency_level: 4700,
      levels: {
        basic: { intuitive_definition: 'Having more than one possible meaning.', metaphor: 'A sign pointing two ways.' },
        intermediate: { mechanism_and_nuance: 'Unclear because of double reading, not mere vagueness.', examples: ['An ambiguous sentence.', 'The ending is ambiguous.'] },
        advanced: { exceptions: 'Ambiguous ≠ ambivalent (mixed feelings).', deep_dive: 'Linguistics: lexical vs structural ambiguity; writing should eliminate unintended ones.' }
      }
    },
    {
      word_id: 27, word: 'mitigate', part_of_speech: 'v', frequency_level: 4900,
      levels: {
        basic: { intuitive_definition: 'Make a problem less severe.', metaphor: 'Turning down the heat, not removing the stove.' },
        intermediate: { mechanism_and_nuance: 'Risk/climate/business jargon for reduce impact.', examples: ['Mitigate the damage.', 'Steps to mitigate risk.'] },
        advanced: { exceptions: 'Mitigate ≠ eliminate; “mitigate against” is often nonstandard.', deep_dive: 'Policy: mitigation vs adaptation in climate discourse.' }
      }
    },
    {
      word_id: 28, word: 'paradigm', part_of_speech: 'n', frequency_level: 5100,
      levels: {
        basic: { intuitive_definition: 'A typical example or way of thinking in a field.', metaphor: 'The map everyone used — until a new map arrives.' },
        intermediate: { mechanism_and_nuance: 'Model/pattern; “paradigm shift” = deep change of framework.', examples: ['A new research paradigm.', 'Paradigm shift in design.'] },
        advanced: { exceptions: 'Overused buzzword; prefer “model/framework” when plain.', deep_dive: 'Kuhn’s history of science: paradigms organise normal science.' }
      }
    },
    {
      word_id: 29, word: 'ubiquitous', part_of_speech: 'adj', frequency_level: 5300,
      levels: {
        basic: { intuitive_definition: 'Seeming to be everywhere.', metaphor: 'Wifi signals filling a café.' },
        intermediate: { mechanism_and_nuance: 'High-frequency literary/tech adjective.', examples: ['Smartphones are ubiquitous.', 'A ubiquitous brand.'] },
        advanced: { exceptions: 'Not “universal” logically; ubiquity is perceptual prevalence.', deep_dive: 'Tech: ubiquitous computing = computing woven into environment.' }
      }
    },
    {
      word_id: 30, word: 'nuance', part_of_speech: 'n', frequency_level: 5450,
      levels: {
        basic: { intuitive_definition: 'A small but important difference in meaning.', metaphor: 'A spice you notice only when tasting carefully.' },
        intermediate: { mechanism_and_nuance: 'Subtle shade; “nuanced” = careful, not black-and-white.', examples: ['Mind the nuance.', 'A nuanced answer.'] },
        advanced: { exceptions: 'Does not mean “detail” in general; specifically shades of meaning/tone.', deep_dive: 'Diplomacy: nuanced positions allow multiple true readings without contradiction.' }
      }
    },
    {
      word_id: 31, word: 'juxtapose', part_of_speech: 'v', frequency_level: 5600,
      levels: {
        basic: { intuitive_definition: 'Place things side by side to compare or contrast.', metaphor: 'Framing two photos in one window.' },
        intermediate: { mechanism_and_nuance: 'Art/criticism verb; creates meaning via contrast.', examples: ['The film juxtaposes wealth and poverty.', 'Juxtapose these claims.'] },
        advanced: { exceptions: 'Not mere “put next to”; the adjacency does interpretive work.', deep_dive: 'Visual rhetoric: juxtaposition can imply causation without stating it.' }
      }
    },
    {
      word_id: 32, word: 'esoteric', part_of_speech: 'adj', frequency_level: 5750,
      levels: {
        basic: { intuitive_definition: 'Understood by only a small group of specialists.', metaphor: 'A password club for experts.' },
        intermediate: { mechanism_and_nuance: 'Obscure knowledge; can praise depth or criticise inaccessibility.', examples: ['An esoteric theory.', 'Esoteric jargon.'] },
        advanced: { exceptions: '≠ exotic (strange foreign); focus is insider knowledge.', deep_dive: 'Pedagogy tension: rigor vs audience — esoteric writing loses readers.' }
      }
    },
    {
      word_id: 33, word: 'ephemeral', part_of_speech: 'adj', frequency_level: 5850,
      levels: {
        basic: { intuitive_definition: 'Lasting for a very short time.', metaphor: 'A soap bubble.' },
        intermediate: { mechanism_and_nuance: 'Literary tone for fleeting beauty/experiences.', examples: ['Ephemeral trends.', 'An ephemeral moment.'] },
        advanced: { exceptions: 'Tech: ephemeral messaging = auto-deleting.', deep_dive: 'Art history: ephemeral works challenge permanence as value.' }
      }
    },
    {
      word_id: 34, word: 'equivocal', part_of_speech: 'adj', frequency_level: 5950,
      levels: {
        basic: { intuitive_definition: 'Unclear because it can mean more than one thing on purpose.', metaphor: 'An answer that wears two masks.' },
        intermediate: { mechanism_and_nuance: 'Often deliberate ambiguity; “unequivocal” = crystal clear.', examples: ['An equivocal response.', 'The data are equivocal.'] },
        advanced: { exceptions: 'Stronger moral shade than ambiguous when motives matter.', deep_dive: 'Rhetoric: equivocation can be a fallacy — sliding between senses mid-argument.' }
      }
    },
    {
      word_id: 35, word: 'sine qua non', part_of_speech: 'n', frequency_level: 6000,
      levels: {
        basic: { intuitive_definition: 'An absolutely necessary condition.', metaphor: 'The one ingredient the recipe cannot omit.' },
        intermediate: { mechanism_and_nuance: 'Latin loan used in formal/academic English.', examples: ['Trust is a sine qua non of teamwork.', 'A sine qua non for success.'] },
        advanced: { exceptions: 'Keep italicization style consistent with house style guides.', deep_dive: 'Logic: necessary but not always sufficient condition.' }
      }
    },
    {
      word_id: 36, word: 'apple', part_of_speech: 'n', frequency_level: 40,
      levels: {
        basic: { intuitive_definition: 'A round fruit that grows on trees.', metaphor: 'The classic lunchbox red circle.' },
        intermediate: { mechanism_and_nuance: 'Also brand name in tech; proverb “apple of my eye.”', examples: ['She ate an apple.', 'An apple a day…'] },
        advanced: { exceptions: 'Idiom “upset the apple cart” = spoil a plan.', deep_dive: 'Cultural symbolism: knowledge, health, temptation — context decides.' }
      }
    },
    {
      word_id: 37, word: 'because', part_of_speech: 'conj', frequency_level: 90,
      levels: {
        basic: { intuitive_definition: 'Gives a reason.', metaphor: 'An arrow that points to why.' },
        intermediate: { mechanism_and_nuance: 'because + clause; because of + noun.', examples: ['I stayed because it rained.', 'Because of traffic, we were late.'] },
        advanced: { exceptions: 'Avoid “the reason is because” in formal writing.', deep_dive: 'Causality claims need care; because ≠ correlation.' }
      }
    },
    {
      word_id: 38, word: 'however', part_of_speech: 'adv', frequency_level: 980,
      levels: {
        basic: { intuitive_definition: 'Shows a contrast — “but” in a fancier coat.', metaphor: 'A speed bump in the argument.' },
        intermediate: { mechanism_and_nuance: 'Sentence adverb with commas; also “however + adj” = no matter how.', examples: ['It was hard. However, we finished.', 'However fast you run…'] },
        advanced: { exceptions: 'Don’t fuse run-ons with however as a comma splice.', deep_dive: 'Academic cohesion device; overuse flattens prose.' }
      }
    },
    {
      word_id: 39, word: 'hypothesis', part_of_speech: 'n', frequency_level: 4200,
      levels: {
        basic: { intuitive_definition: 'An educated guess you can test.', metaphor: 'A draft answer waiting for evidence.' },
        intermediate: { mechanism_and_nuance: 'Science method; plural hypotheses.', examples: ['Test the hypothesis.', 'A working hypothesis.'] },
        advanced: { exceptions: 'Hypothesis ≠ theory (theory is broader, better supported).', deep_dive: 'Null hypothesis testing is statistical procedure, not everyday guessing.' }
      }
    },
    {
      word_id: 40, word: 'rhetoric', part_of_speech: 'n', frequency_level: 4800,
      levels: {
        basic: { intuitive_definition: 'Skillful language used to persuade.', metaphor: 'Word architecture built to move an audience.' },
        intermediate: { mechanism_and_nuance: 'Can be neutral (art of persuasion) or critical (“empty rhetoric”).', examples: ['Political rhetoric.', 'Study classical rhetoric.'] },
        advanced: { exceptions: 'Rhetorical question expects no literal answer.', deep_dive: 'Ethos/pathos/logos remain useful analytic toolkit.' }
      }
    }
  ];

  // Grade 1-12 / gamified tier ladder — mirrors server/src/vocabPlacementService.js.
  var TIERS = [
    { id: 1, name: 'Rookie', gradeLevel: 1 },
    { id: 2, name: 'Iron', gradeLevel: 2 },
    { id: 3, name: 'Bronze', gradeLevel: 3 },
    { id: 4, name: 'Silver', gradeLevel: 4 },
    { id: 5, name: 'Gold', gradeLevel: 5 },
    { id: 6, name: 'Platinum', gradeLevel: 6 },
    { id: 7, name: 'Emerald', gradeLevel: 7 },
    { id: 8, name: 'Diamond', gradeLevel: 8 },
    { id: 9, name: 'Ascendant', gradeLevel: 9 },
    { id: 10, name: 'Master', gradeLevel: 10 },
    { id: 11, name: 'Grandmaster', gradeLevel: 11 },
    { id: 12, name: 'Legend', gradeLevel: 12 }
  ];

  function byFrequency(a, b) {
    return a.frequency_level - b.frequency_level;
  }

  function tierForGrade(grade) {
    var g = Math.max(1, Math.min(12, Math.round(Number(grade) || 1)));
    return TIERS[g - 1];
  }

  // Assign a grade_level (1-12) to each mock word by its rank among all words, spread
  // evenly across the ladder — used for the (local, zero-latency) placement test only.
  // Real word-bank words come from Supabase with an AI-estimated grade_level instead.
  (function assignGradeLevels() {
    var byFreq = WORDS.slice().sort(byFrequency);
    byFreq.forEach(function (w, i) {
      w.grade_level = Math.min(12, Math.floor((i / byFreq.length) * 12) + 1);
      w.tier_name = tierForGrade(w.grade_level).name;
    });
  })();

  function sortedWords() {
    return WORDS.slice().sort(byFrequency);
  }

  function findNearestGrade(grade) {
    var list = sortedWords();
    var best = list[0];
    var bestDiff = Math.abs(best.grade_level - grade);
    for (var i = 1; i < list.length; i++) {
      var d = Math.abs(list[i].grade_level - grade);
      if (d < bestDiff) {
        best = list[i];
        bestDiff = d;
      }
    }
    return best;
  }

  function wordsInGrade(center, radius) {
    radius = radius == null ? 1 : radius;
    return sortedWords().filter(function (w) {
      return Math.abs(w.grade_level - center) <= radius;
    });
  }

  root.MrParkVocabData = {
    WORDS: WORDS,
    TIERS: TIERS,
    GRADE_MIN: 1,
    GRADE_MAX: 12,
    sortedWords: sortedWords,
    findNearestGrade: findNearestGrade,
    tierForGrade: tierForGrade,
    wordsInGrade: wordsInGrade
  };
})(typeof window !== 'undefined' ? window : globalThis);
