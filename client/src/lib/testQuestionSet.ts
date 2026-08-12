// Built-in question set covering every question type the app currently
// supports (number, geo, fuzzy-text). Used by the "start quiz with test
// data" button in AdminView as a stand-in until the real ZIP/JSON upload
// pipeline lands (see issue #4). Validated server-side against the same
// questionSetSchema a real upload would go through.
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
