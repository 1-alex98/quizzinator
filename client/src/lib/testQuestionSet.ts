// Built-in question set covering every question type the app currently
// supports (number, geo, fuzzy-text). Used by the "start quiz with test
// data" button in AdminView as a quick way to try the app without preparing
// a real upload. Validated server-side against the same questionSetSchema a
// real upload goes through.
export const TEST_QUESTION_SET = {
  id: "quizzinator-test-set",
  title: "Quizzinator Test Set",
  questions: [
    {
      id: "q-number",
      type: "number",
      prompt: "In what year did the Berlin Wall fall?",
      points: 100,
      timeLimitSec: 30,
      min: 1900,
      max: 2026,
      step: 1,
      correctValue: 1989,
      // The slider spans a century so the answer isn't obvious from where the
      // handle starts, but only guesses within two decades should score.
      scoreToleranceValue: 20,
    },
    {
      id: "q-geo",
      type: "geo",
      prompt: "Where is the Eiffel Tower?",
      points: 100,
      timeLimitSec: 30,
      correctLat: 48.8584,
      correctLng: 2.2945,
      maxDistanceKm: 1000,
    },
    {
      id: "q-fuzzy",
      type: "fuzzy-text",
      prompt: "Who painted the Mona Lisa?",
      points: 100,
      timeLimitSec: 30,
      acceptedAnswers: ["Leonardo da Vinci", "Da Vinci"],
      threshold: 0.75,
      media: { imageUrl: "https://picsum.photos/id/237/400/300" },
    },
  ],
} as const;
