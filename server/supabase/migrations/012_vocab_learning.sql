-- AI Vocab Learning: word bank, SRS progress, daily quests, class settings
CREATE TABLE IF NOT EXISTS vocab_words (
  word_id           TEXT PRIMARY KEY,
  word              TEXT NOT NULL,
  part_of_speech    TEXT,
  frequency_level   INTEGER NOT NULL CHECK (frequency_level BETWEEN 1 AND 6000),
  levels            JSONB NOT NULL,
  source            TEXT NOT NULL DEFAULT 'upload',
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vocab_words_freq_idx ON vocab_words (frequency_level);
CREATE INDEX IF NOT EXISTS vocab_words_active_idx ON vocab_words (active);

-- Per-student placement result + streak summary
CREATE TABLE IF NOT EXISTS vocab_student_state (
  student_id            TEXT PRIMARY KEY REFERENCES students(id) ON UPDATE CASCADE,
  class_id              TEXT,
  ability_freq          INTEGER,
  tier_id               INTEGER,
  tier_name             TEXT,
  start_frequency_level INTEGER,
  placement_accuracy    NUMERIC,
  placement_at          TIMESTAMPTZ,
  streak_days           INTEGER NOT NULL DEFAULT 0,
  longest_streak        INTEGER NOT NULL DEFAULT 0,
  last_completed_date   DATE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leitner-style spaced repetition progress, one row per student+word
CREATE TABLE IF NOT EXISTS vocab_student_progress (
  id             BIGSERIAL PRIMARY KEY,
  student_id     TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  class_id       TEXT,
  word_id        TEXT NOT NULL REFERENCES vocab_words(word_id) ON UPDATE CASCADE ON DELETE CASCADE,
  box            INTEGER NOT NULL DEFAULT 0,
  next_due_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  correct_count  INTEGER NOT NULL DEFAULT 0,
  wrong_count    INTEGER NOT NULL DEFAULT 0,
  last_result    BOOLEAN,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, word_id)
);

CREATE INDEX IF NOT EXISTS vocab_student_progress_due_idx
  ON vocab_student_progress (student_id, next_due_at);

-- One row per student per calendar day: today's quest progress + reward
CREATE TABLE IF NOT EXISTS vocab_daily_progress (
  id              BIGSERIAL PRIMARY KEY,
  student_id      TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  class_id        TEXT,
  quest_date      DATE NOT NULL,
  target_count    INTEGER NOT NULL DEFAULT 10,
  studied_count   INTEGER NOT NULL DEFAULT 0,
  studied_word_ids TEXT NOT NULL DEFAULT '[]',
  test_attempts   INTEGER NOT NULL DEFAULT 0,
  test_score      NUMERIC,
  test_passed     BOOLEAN NOT NULL DEFAULT false,
  reward_ticket_id TEXT,
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, quest_date)
);

CREATE INDEX IF NOT EXISTS vocab_daily_progress_class_date_idx
  ON vocab_daily_progress (class_id, quest_date DESC);

-- Per-class teacher-configurable daily target + reward tier
CREATE TABLE IF NOT EXISTS vocab_class_settings (
  class_id       TEXT PRIMARY KEY REFERENCES classes(id) ON UPDATE CASCADE,
  daily_target   INTEGER NOT NULL DEFAULT 10,
  pass_threshold NUMERIC NOT NULL DEFAULT 70,
  reward_tier    TEXT NOT NULL DEFAULT 'Common',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vocab_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_student_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_student_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_daily_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_class_settings ENABLE ROW LEVEL SECURITY;

-- Seed word bank from the original DB-free mock pack (40 words spanning the 1–6000 spectrum)
INSERT INTO vocab_words (word_id, word, part_of_speech, frequency_level, levels, source, active) VALUES
('w1', 'happy', 'adj', 120, '{"basic":{"intuitive_definition":"Feeling good inside.","metaphor":"Like sunshine in your chest."},"intermediate":{"mechanism_and_nuance":"Everyday positive mood; softer than “joyful,” less formal than “content.”","examples":["She felt happy after the game.","I’m happy to help."]},"advanced":{"exceptions":"In set phrases (“happy to…”) it often means willing, not emotional.","deep_dive":"Business: “We are happy to confirm…” = polite willingness, not emotion."}}'::jsonb, 'seed', true),
('w2', 'run', 'v', 180, '{"basic":{"intuitive_definition":"Move fast on your feet.","metaphor":"Like your legs are racing."},"intermediate":{"mechanism_and_nuance":"Also means operate (a machine) or manage (a business).","examples":["Kids run in the park.","They run a small shop."]},"advanced":{"exceptions":"“Run into” = meet by chance; “run out of” = have none left.","deep_dive":"Phrasal verbs multiply meaning; tense + particle decide the sense."}}'::jsonb, 'seed', true),
('w3', 'bright', 'adj', 450, '{"basic":{"intuitive_definition":"Full of light, or smart.","metaphor":"Like a lightbulb that is on."},"intermediate":{"mechanism_and_nuance":"Literal light vs figurative intelligence / hope.","examples":["Bright sunlight filled the room.","She has a bright idea."]},"advanced":{"exceptions":"“Bright future” is metaphorical hope, not IQ.","deep_dive":"In academic writing prefer precise alternatives: luminous, intelligent, promising."}}'::jsonb, 'seed', true),
('w4', 'careful', 'adj', 620, '{"basic":{"intuitive_definition":"Paying attention so nothing goes wrong.","metaphor":"Walking on eggshells on purpose."},"intermediate":{"mechanism_and_nuance":"About caution; “careful with words” means thoughtful speech.","examples":["Be careful crossing the street.","He was careful with the glass."]},"advanced":{"exceptions":"Not the same as “caring” (kind). “Careless” is the opposite.","deep_dive":"Legal/formal tone: “due care,” “with care” = diligence."}}'::jsonb, 'seed', true),
('w5', 'choose', 'v', 780, '{"basic":{"intuitive_definition":"Pick one thing from options.","metaphor":"Pointing at one door among many."},"intermediate":{"mechanism_and_nuance":"Irregular: choose / chose / chosen. “Select” is more formal.","examples":["I choose the blue shirt.","She chose to stay."]},"advanced":{"exceptions":"“Choose to + verb” = decide to act; not always from a menu of objects.","deep_dive":"Nuance vs decide: choose highlights alternatives; decide highlights the decision moment."}}'::jsonb, 'seed', true),
('w6', 'invite', 'v', 950, '{"basic":{"intuitive_definition":"Ask someone to come or join.","metaphor":"Opening the door for a guest."},"intermediate":{"mechanism_and_nuance":"Social request; “invite criticism” = make something likely (figurative).","examples":["She invited me to lunch.","Don’t invite trouble."]},"advanced":{"exceptions":"Passive “be invited” ≠ “be welcome” automatically.","deep_dive":"Formal RSVP culture: invitation implies response expectation."}}'::jsonb, 'seed', true),
('w7', 'improve', 'v', 1100, '{"basic":{"intuitive_definition":"Make something better.","metaphor":"Turning a rough draft into a neat one."},"intermediate":{"mechanism_and_nuance":"Progress over time; often with “in / at” skills.","examples":["Practice will improve your writing.","The weather improved."]},"advanced":{"exceptions":"“Improve on” = do better than a previous version.","deep_dive":"Business: continuous improvement ≠ one-off fix."}}'::jsonb, 'seed', true),
('w8', 'decide', 'v', 1250, '{"basic":{"intuitive_definition":"Make a final choice.","metaphor":"Closing the book on options."},"intermediate":{"mechanism_and_nuance":"“Decide on/against + noun”; “decide to + verb”.","examples":["We decided to leave early.","He can’t decide."]},"advanced":{"exceptions":"“Decide” implies resolution; “consider” stops earlier.","deep_dive":"Judicial tone: decide a case = render a ruling."}}'::jsonb, 'seed', true),
('w9', 'compare', 'v', 1400, '{"basic":{"intuitive_definition":"Look at how things are similar or different.","metaphor":"Holding two photos side by side."},"intermediate":{"mechanism_and_nuance":"compare A with/to B; “compared to” often introduces contrast.","examples":["Compare these two answers.","Compared to last year, sales rose."]},"advanced":{"exceptions":"“Compare to” (likeness) vs “compare with” (analysis) — textbooks debate this.","deep_dive":"Academic: comparison criteria must be explicit to avoid false equivalence."}}'::jsonb, 'seed', true),
('w10', 'aware', 'adj', 1550, '{"basic":{"intuitive_definition":"Knowing that something exists or is happening.","metaphor":"Your mental radar is on."},"intermediate":{"mechanism_and_nuance":"aware of + noun; “self-aware” = knowing your own habits.","examples":["Are you aware of the rule?","She became aware of the noise."]},"advanced":{"exceptions":"Not “know” + object of skill; awareness ≠ mastery.","deep_dive":"Critical writing: “raising awareness” often means public attention, not deep knowledge."}}'::jsonb, 'seed', true),
('w11', 'evidence', 'n', 1750, '{"basic":{"intuitive_definition":"Facts that show something is true.","metaphor":"Clues left on the table."},"intermediate":{"mechanism_and_nuance":"Usually uncountable; “pieces of evidence.”","examples":["There is no evidence yet.","The photo is strong evidence."]},"advanced":{"exceptions":"Legal “evidence” has procedure rules; everyday talk is looser.","deep_dive":"Science: evidence supports hypotheses; it rarely “proves” forever."}}'::jsonb, 'seed', true),
('w12', 'benefit', 'n', 1900, '{"basic":{"intuitive_definition":"A good result you get from something.","metaphor":"A prize attached to a choice."},"intermediate":{"mechanism_and_nuance":"Also a verb: benefit from. “For the benefit of” = to help.","examples":["Exercise has many benefits.","Students benefit from feedback."]},"advanced":{"exceptions":"“Benefits” at work can mean insurance/perks package.","deep_dive":"Cost–benefit analysis weighs trade-offs, not only positives."}}'::jsonb, 'seed', true),
('w13', 'approach', 'n/v', 2100, '{"basic":{"intuitive_definition":"A way of doing something, or to come closer.","metaphor":"Choosing a path toward a door."},"intermediate":{"mechanism_and_nuance":"Method sense (noun) vs physical/metaphorical coming near (verb).","examples":["Try a new approach.","Winter is approaching."]},"advanced":{"exceptions":"“Approachable” = easy to talk to — person trait, not method.","deep_dive":"Academic: methodological approach vs theoretical framework."}}'::jsonb, 'seed', true),
('w14', 'assume', 'v', 2300, '{"basic":{"intuitive_definition":"Believe something without full proof.","metaphor":"Filling a blank with a guess."},"intermediate":{"mechanism_and_nuance":"Can also mean take on a role/duty (“assume responsibility”).","examples":["Don’t assume she’s angry.","He assumed control."]},"advanced":{"exceptions":"“Assume” ≠ “presume” exactly; presume often implies stronger prior reason.","deep_dive":"Logic: assumptions must be stated to test an argument."}}'::jsonb, 'seed', true),
('w15', 'significant', 'adj', 2500, '{"basic":{"intuitive_definition":"Important enough to notice.","metaphor":"A stone that changes the scale reading."},"intermediate":{"mechanism_and_nuance":"Everyday “important” + statistics “unlikely by chance.”","examples":["A significant change.","The result was statistically significant."]},"advanced":{"exceptions":"Statistically significant ≠ practically large.","deep_dive":"Science writing: report effect size with significance."}}'::jsonb, 'seed', true),
('w16', 'maintain', 'v', 2700, '{"basic":{"intuitive_definition":"Keep something the same or in good condition.","metaphor":"Holding a balloon so it doesn’t float away."},"intermediate":{"mechanism_and_nuance":"Also insist (“maintain that…”).","examples":["Maintain eye contact.","She maintains that she is right."]},"advanced":{"exceptions":"Technical: maintain a system = service it; not start it.","deep_dive":"Policy: maintain order ≠ restore order after collapse."}}'::jsonb, 'seed', true),
('w17', 'indicate', 'v', 2900, '{"basic":{"intuitive_definition":"Show or point to something.","metaphor":"An arrow on a sign."},"intermediate":{"mechanism_and_nuance":"Neutral reporting verb in essays; softer than “prove.”","examples":["Surveys indicate a rise.","The light indicates power."]},"advanced":{"exceptions":"Medical “indicated” = recommended treatment context.","deep_dive":"Academic hedging: indicate / suggest / demonstrate hierarchy."}}'::jsonb, 'seed', true),
('w18', 'establish', 'v', 3100, '{"basic":{"intuitive_definition":"Set something up so it exists firmly.","metaphor":"Planting a flag that stays."},"intermediate":{"mechanism_and_nuance":"Create institutions, rules, or prove facts.","examples":["They established a club.","The study established a link."]},"advanced":{"exceptions":"“Well-established” = long accepted, not newly founded.","deep_dive":"Legal: establish liability = meet the burden of proof."}}'::jsonb, 'seed', true),
('w19', 'crucial', 'adj', 3300, '{"basic":{"intuitive_definition":"Extremely important for success.","metaphor":"The keystone of an arch."},"intermediate":{"mechanism_and_nuance":"Stronger than “important”; implies a tipping-point role.","examples":["Timing is crucial.","A crucial decision."]},"advanced":{"exceptions":"Avoid stacking with “very” (“very crucial” sounds weak).","deep_dive":"Rhetoric: overusing crucial drains force — reserve it."}}'::jsonb, 'seed', true),
('w20', 'analyze', 'v', 3500, '{"basic":{"intuitive_definition":"Break something into parts to understand it.","metaphor":"Opening a watch to see the gears."},"intermediate":{"mechanism_and_nuance":"Academic key verb; UK spelling analyse.","examples":["Analyze the text.","We analyzed the data."]},"advanced":{"exceptions":"Analyze ≠ summarize; summary keeps whole, analysis dissects.","deep_dive":"Methods: qualitative analysis vs quantitative modeling."}}'::jsonb, 'seed', true),
('w21', 'nevertheless', 'adv', 3700, '{"basic":{"intuitive_definition":"Even so; despite that.","metaphor":"A bridge across “but.”"},"intermediate":{"mechanism_and_nuance":"Contrast linker like however; often sentence-initial with comma.","examples":["It rained. Nevertheless, we played.","Hard, nevertheless worth it."]},"advanced":{"exceptions":"More formal than “still”; rare in casual speech.","deep_dive":"Cohesion: nevertheless vs nonetheless nearly synonymous."}}'::jsonb, 'seed', true),
('w22', 'implication', 'n', 3900, '{"basic":{"intuitive_definition":"A meaning or result that is suggested, not said directly.","metaphor":"Ripples after a stone drops."},"intermediate":{"mechanism_and_nuance":"Logical consequence; “by implication.”","examples":["What are the implications?","Her silence had implications."]},"advanced":{"exceptions":"Implication ≠ inference (one is produced, one is drawn).","deep_dive":"Policy briefs: implications = what decision-makers should notice next."}}'::jsonb, 'seed', true),
('w23', 'substantial', 'adj', 4100, '{"basic":{"intuitive_definition":"Large in amount or importance.","metaphor":"A heavy bag, not a feather."},"intermediate":{"mechanism_and_nuance":"Quantity/size + seriousness (“substantial evidence”).","examples":["A substantial increase.","Substantial progress."]},"advanced":{"exceptions":"Philosophy: “substance” has specialised ontology senses.","deep_dive":"Finance: substantial ownership thresholds are defined numerically."}}'::jsonb, 'seed', true),
('w24', 'constitute', 'v', 4300, '{"basic":{"intuitive_definition":"Make up or form something.","metaphor":"Bricks that are the wall."},"intermediate":{"mechanism_and_nuance":"Formal “be” for identity/composition.","examples":["These form / constitute a team.","That constitutes a breach."]},"advanced":{"exceptions":"Not everyday speech; prefer “make up” or “is.”","deep_dive":"Law: “constitutes an offense” = legally qualifies as."}}'::jsonb, 'seed', true),
('w25', 'discrepancy', 'n', 4500, '{"basic":{"intuitive_definition":"A difference between things that should match.","metaphor":"Two puzzle pieces that don’t fit."},"intermediate":{"mechanism_and_nuance":"Neutral/technical mismatch; often in data/reports.","examples":["A discrepancy in the totals.","Explain the discrepancy."]},"advanced":{"exceptions":"Stronger than difference; implies inconsistency needing resolution.","deep_dive":"Audit language: investigate discrepancies before concluding fraud."}}'::jsonb, 'seed', true),
('w26', 'ambiguous', 'adj', 4700, '{"basic":{"intuitive_definition":"Having more than one possible meaning.","metaphor":"A sign pointing two ways."},"intermediate":{"mechanism_and_nuance":"Unclear because of double reading, not mere vagueness.","examples":["An ambiguous sentence.","The ending is ambiguous."]},"advanced":{"exceptions":"Ambiguous ≠ ambivalent (mixed feelings).","deep_dive":"Linguistics: lexical vs structural ambiguity; writing should eliminate unintended ones."}}'::jsonb, 'seed', true),
('w27', 'mitigate', 'v', 4900, '{"basic":{"intuitive_definition":"Make a problem less severe.","metaphor":"Turning down the heat, not removing the stove."},"intermediate":{"mechanism_and_nuance":"Risk/climate/business jargon for reduce impact.","examples":["Mitigate the damage.","Steps to mitigate risk."]},"advanced":{"exceptions":"Mitigate ≠ eliminate; “mitigate against” is often nonstandard.","deep_dive":"Policy: mitigation vs adaptation in climate discourse."}}'::jsonb, 'seed', true),
('w28', 'paradigm', 'n', 5100, '{"basic":{"intuitive_definition":"A typical example or way of thinking in a field.","metaphor":"The map everyone used — until a new map arrives."},"intermediate":{"mechanism_and_nuance":"Model/pattern; “paradigm shift” = deep change of framework.","examples":["A new research paradigm.","Paradigm shift in design."]},"advanced":{"exceptions":"Overused buzzword; prefer “model/framework” when plain.","deep_dive":"Kuhn’s history of science: paradigms organise normal science."}}'::jsonb, 'seed', true),
('w29', 'ubiquitous', 'adj', 5300, '{"basic":{"intuitive_definition":"Seeming to be everywhere.","metaphor":"Wifi signals filling a café."},"intermediate":{"mechanism_and_nuance":"High-frequency literary/tech adjective.","examples":["Smartphones are ubiquitous.","A ubiquitous brand."]},"advanced":{"exceptions":"Not “universal” logically; ubiquity is perceptual prevalence.","deep_dive":"Tech: ubiquitous computing = computing woven into environment."}}'::jsonb, 'seed', true),
('w30', 'nuance', 'n', 5450, '{"basic":{"intuitive_definition":"A small but important difference in meaning.","metaphor":"A spice you notice only when tasting carefully."},"intermediate":{"mechanism_and_nuance":"Subtle shade; “nuanced” = careful, not black-and-white.","examples":["Mind the nuance.","A nuanced answer."]},"advanced":{"exceptions":"Does not mean “detail” in general; specifically shades of meaning/tone.","deep_dive":"Diplomacy: nuanced positions allow multiple true readings without contradiction."}}'::jsonb, 'seed', true),
('w31', 'juxtapose', 'v', 5600, '{"basic":{"intuitive_definition":"Place things side by side to compare or contrast.","metaphor":"Framing two photos in one window."},"intermediate":{"mechanism_and_nuance":"Art/criticism verb; creates meaning via contrast.","examples":["The film juxtaposes wealth and poverty.","Juxtapose these claims."]},"advanced":{"exceptions":"Not mere “put next to”; the adjacency does interpretive work.","deep_dive":"Visual rhetoric: juxtaposition can imply causation without stating it."}}'::jsonb, 'seed', true),
('w32', 'esoteric', 'adj', 5750, '{"basic":{"intuitive_definition":"Understood by only a small group of specialists.","metaphor":"A password club for experts."},"intermediate":{"mechanism_and_nuance":"Obscure knowledge; can praise depth or criticise inaccessibility.","examples":["An esoteric theory.","Esoteric jargon."]},"advanced":{"exceptions":"≠ exotic (strange foreign); focus is insider knowledge.","deep_dive":"Pedagogy tension: rigor vs audience — esoteric writing loses readers."}}'::jsonb, 'seed', true),
('w33', 'ephemeral', 'adj', 5850, '{"basic":{"intuitive_definition":"Lasting for a very short time.","metaphor":"A soap bubble."},"intermediate":{"mechanism_and_nuance":"Literary tone for fleeting beauty/experiences.","examples":["Ephemeral trends.","An ephemeral moment."]},"advanced":{"exceptions":"Tech: ephemeral messaging = auto-deleting.","deep_dive":"Art history: ephemeral works challenge permanence as value."}}'::jsonb, 'seed', true),
('w34', 'equivocal', 'adj', 5950, '{"basic":{"intuitive_definition":"Unclear because it can mean more than one thing on purpose.","metaphor":"An answer that wears two masks."},"intermediate":{"mechanism_and_nuance":"Often deliberate ambiguity; “unequivocal” = crystal clear.","examples":["An equivocal response.","The data are equivocal."]},"advanced":{"exceptions":"Stronger moral shade than ambiguous when motives matter.","deep_dive":"Rhetoric: equivocation can be a fallacy — sliding between senses mid-argument."}}'::jsonb, 'seed', true),
('w35', 'sine qua non', 'n', 6000, '{"basic":{"intuitive_definition":"An absolutely necessary condition.","metaphor":"The one ingredient the recipe cannot omit."},"intermediate":{"mechanism_and_nuance":"Latin loan used in formal/academic English.","examples":["Trust is a sine qua non of teamwork.","A sine qua non for success."]},"advanced":{"exceptions":"Keep italicization style consistent with house style guides.","deep_dive":"Logic: necessary but not always sufficient condition."}}'::jsonb, 'seed', true),
('w36', 'apple', 'n', 40, '{"basic":{"intuitive_definition":"A round fruit that grows on trees.","metaphor":"The classic lunchbox red circle."},"intermediate":{"mechanism_and_nuance":"Also brand name in tech; proverb “apple of my eye.”","examples":["She ate an apple.","An apple a day…"]},"advanced":{"exceptions":"Idiom “upset the apple cart” = spoil a plan.","deep_dive":"Cultural symbolism: knowledge, health, temptation — context decides."}}'::jsonb, 'seed', true),
('w37', 'because', 'conj', 90, '{"basic":{"intuitive_definition":"Gives a reason.","metaphor":"An arrow that points to why."},"intermediate":{"mechanism_and_nuance":"because + clause; because of + noun.","examples":["I stayed because it rained.","Because of traffic, we were late."]},"advanced":{"exceptions":"Avoid “the reason is because” in formal writing.","deep_dive":"Causality claims need care; because ≠ correlation."}}'::jsonb, 'seed', true),
('w38', 'however', 'adv', 980, '{"basic":{"intuitive_definition":"Shows a contrast — “but” in a fancier coat.","metaphor":"A speed bump in the argument."},"intermediate":{"mechanism_and_nuance":"Sentence adverb with commas; also “however + adj” = no matter how.","examples":["It was hard. However, we finished.","However fast you run…"]},"advanced":{"exceptions":"Don’t fuse run-ons with however as a comma splice.","deep_dive":"Academic cohesion device; overuse flattens prose."}}'::jsonb, 'seed', true),
('w39', 'hypothesis', 'n', 4200, '{"basic":{"intuitive_definition":"An educated guess you can test.","metaphor":"A draft answer waiting for evidence."},"intermediate":{"mechanism_and_nuance":"Science method; plural hypotheses.","examples":["Test the hypothesis.","A working hypothesis."]},"advanced":{"exceptions":"Hypothesis ≠ theory (theory is broader, better supported).","deep_dive":"Null hypothesis testing is statistical procedure, not everyday guessing."}}'::jsonb, 'seed', true),
('w40', 'rhetoric', 'n', 4800, '{"basic":{"intuitive_definition":"Skillful language used to persuade.","metaphor":"Word architecture built to move an audience."},"intermediate":{"mechanism_and_nuance":"Can be neutral (art of persuasion) or critical (“empty rhetoric”).","examples":["Political rhetoric.","Study classical rhetoric."]},"advanced":{"exceptions":"Rhetorical question expects no literal answer.","deep_dive":"Ethos/pathos/logos remain useful analytic toolkit."}}'::jsonb, 'seed', true)
ON CONFLICT (word_id) DO NOTHING;
