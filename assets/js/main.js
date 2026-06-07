const year = document.querySelector("#year");

if (year) {
  year.textContent = new Date().getFullYear();
}

const earthquakeGame = document.querySelector('[data-game="earthquake-ready"]');

if (earthquakeGame) {
  const missions = [
    {
      label: "Physical geography",
      title: "What usually causes an earthquake?",
      text: "Choose the best explanation for why the ground can suddenly shake.",
      options: [
        "Tectonic plates suddenly move along a fault",
        "Clouds push heavy rain into the ground",
        "The Moon pulls mountains sideways"
      ],
      correct: 0,
      feedback: "Yes. Pressure can build where plates meet, then release as shaking."
    },
    {
      label: "Map thinking",
      title: "Where do many earthquakes happen?",
      text: "A class map shows earthquake dots across the world. What pattern should pupils look for?",
      options: [
        "Only in the middle of deserts",
        "Near tectonic plate boundaries",
        "Only beside the River Thames"
      ],
      correct: 1,
      feedback: "Correct. Many earthquakes happen close to plate boundaries."
    },
    {
      label: "Geography vocabulary",
      title: "Which phrase describes an epicentre?",
      text: "The focus is underground. What is the epicentre?",
      options: [
        "The surface point above where the earthquake starts",
        "A tool used to measure temperature",
        "The name for every mountain on Earth"
      ],
      correct: 0,
      feedback: "Right. The epicentre is the point on the surface above the focus."
    },
    {
      label: "Curriculum link",
      title: "Which pair belongs to physical geography?",
      text: "Pick the pair that describes natural features or processes.",
      options: [
        "Shopping centres and motorways",
        "Volcanoes and earthquakes",
        "Postcodes and school uniforms"
      ],
      correct: 1,
      feedback: "Exactly. Volcanoes and earthquakes are part of physical geography."
    },
    {
      label: "Geographical skills",
      title: "Which tools help locate earthquake places?",
      text: "A pupil wants to find Japan, Chile, and New Zealand after learning they can have earthquakes.",
      options: [
        "Maps, atlases, globes, and digital mapping",
        "Only a stopwatch",
        "A spelling dictionary with no maps"
      ],
      correct: 0,
      feedback: "Yes. Those tools help pupils locate countries and describe where they are."
    },
    {
      label: "People and place",
      title: "What helps a community prepare?",
      text: "Choose a sensible way people can reduce earthquake risk.",
      options: [
        "Ignore warning signs and never practise",
        "Build carefully and practise safety drills",
        "Make all buildings taller and heavier"
      ],
      correct: 1,
      feedback: "Good choice. Preparation can help people stay safer during hazards."
    }
  ];

  const roundCount = earthquakeGame.querySelector("[data-round-count]");
  const scoreCount = earthquakeGame.querySelector("[data-score-count]");
  const readinessFill = earthquakeGame.querySelector("[data-readiness-fill]");
  const questionLabel = earthquakeGame.querySelector("[data-question-label]");
  const questionTitle = earthquakeGame.querySelector("[data-question-title]");
  const questionText = earthquakeGame.querySelector("[data-question-text]");
  const answerGrid = earthquakeGame.querySelector("[data-answer-grid]");
  const feedback = earthquakeGame.querySelector("[data-feedback]");
  const nextButton = earthquakeGame.querySelector("[data-next-question]");
  const resetButton = earthquakeGame.querySelector("[data-reset-game]");

  let currentMission = 0;
  let score = 0;
  let answered = false;

  function updateMeter() {
    readinessFill.style.width = `${(score / missions.length) * 100}%`;
  }

  function renderMission() {
    const mission = missions[currentMission];
    answered = false;

    roundCount.textContent = `${currentMission + 1} / ${missions.length}`;
    scoreCount.textContent = score;
    questionLabel.textContent = mission.label;
    questionTitle.textContent = mission.title;
    questionText.textContent = mission.text;
    feedback.textContent = "";
    nextButton.textContent = currentMission === missions.length - 1 ? "Finish" : "Next";
    nextButton.disabled = true;
    answerGrid.innerHTML = "";
    updateMeter();

    mission.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.className = "answer-choice";
      button.type = "button";
      button.textContent = option;
      button.addEventListener("click", () => chooseAnswer(index, button));
      answerGrid.append(button);
    });
  }

  function chooseAnswer(index, selectedButton) {
    if (answered) {
      return;
    }

    const mission = missions[currentMission];
    const buttons = [...answerGrid.querySelectorAll(".answer-choice")];
    const isCorrect = index === mission.correct;

    answered = true;
    buttons.forEach((button, buttonIndex) => {
      button.disabled = true;
      if (buttonIndex === mission.correct) {
        button.classList.add("is-correct");
      }
    });

    if (isCorrect) {
      score += 1;
      feedback.textContent = mission.feedback;
    } else {
      selectedButton.classList.add("is-incorrect");
      feedback.textContent = `Not quite. ${mission.feedback}`;
    }

    scoreCount.textContent = score;
    updateMeter();
    nextButton.disabled = false;
  }

  function showResult() {
    const strongFinish = score >= 5;

    roundCount.textContent = `${missions.length} / ${missions.length}`;
    scoreCount.textContent = score;
    questionLabel.textContent = "Mission complete";
    questionTitle.textContent = strongFinish ? "Town ready" : "Keep exploring";
    questionText.textContent = strongFinish
      ? "Excellent earthquake thinking. You can explain causes, locations, map tools, and ways people prepare."
      : "Good effort. Try again to strengthen the town readiness meter.";
    feedback.textContent = `Final score: ${score} out of ${missions.length}.`;
    answerGrid.innerHTML = "";
    nextButton.textContent = "Done";
    nextButton.disabled = true;
    updateMeter();
  }

  nextButton.addEventListener("click", () => {
    if (currentMission < missions.length - 1) {
      currentMission += 1;
      renderMission();
      return;
    }

    showResult();
  });

  resetButton.addEventListener("click", () => {
    currentMission = 0;
    score = 0;
    renderMission();
  });

  renderMission();
}
