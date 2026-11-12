import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { correctTileCount, isPuzzleSolved, shuffledTiles, swapTiles, yearChoices } from '../lib/photo-games';
import type { Photograph } from '../lib/photos';
import './PhotoGames.css';

function PhotoCredit({ photo }: { photo: Photograph }) {
  return <p className="game-credit">Photo: <a href={photo.sourceUrl} target="_blank" rel="noreferrer">{photo.creator}</a> · <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a></p>;
}

function PuzzleRound({ photo, onComplete }: { photo: Photograph; onComplete?: () => void }) {
  const [tiles, setTiles] = useState(() => shuffledTiles(9));
  const [selected, setSelected] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const [preview, setPreview] = useState(false);
  const [round, setRound] = useState(0);
  const notified = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const solved = isPuzzleSolved(tiles);
  const matched = correctTileCount(tiles);
  const ratio = photo.width / photo.height;
  const width = 3 * Math.max(ratio, 1);
  const height = 3 * Math.max(1 / ratio, 1);

  useEffect(() => {
    if (solved && !notified.current) {
      notified.current = true;
      resultHeading.current?.focus();
      callback.current?.();
    }
  }, [solved]);

  function choose(position: number) {
    if (solved || preview) return;
    if (selected === null) { setSelected(position); return; }
    if (selected === position) { setSelected(null); return; }
    setTiles(current => swapTiles(current, selected, position));
    setMoves(current => current + 1);
    setSelected(null);
  }

  function shuffle() {
    notified.current = false;
    setSelected(null);
    setMoves(0);
    setPreview(false);
    setTiles(shuffledTiles(9));
    setRound(current => current + 1);
  }

  return <div className={`photo-puzzle${solved ? ' is-solved' : ''}`}>
    <div className="puzzle-picture">
      <div className="puzzle-board" role="group" aria-label="Nine-piece photo puzzle. Select two pieces to swap them.">
        {tiles.map((tile, position) => {
          const source = preview ? position : tile;
          const style: CSSProperties = {
            backgroundImage: `url("${photo.src}")`,
            backgroundSize: `${width * 100}% ${height * 100}%`,
            backgroundPosition: `${((source % 3 + (width - 3) / 2) / (width - 1)) * 100}% ${((Math.floor(source / 3) + (height - 3) / 2) / (height - 1)) * 100}%`,
          };
          return <button key={`${round}-${position}`} type="button" style={style}
            className={`puzzle-piece${selected === position ? ' is-selected' : ''}${tile === position ? ' is-correct' : ''}`}
            aria-label={`Piece ${tile + 1} in position ${position + 1}${tile === position ? ', correct position' : ''}`}
            aria-pressed={selected === position} disabled={solved || preview} onClick={() => choose(position)}>
            {!preview && <span className="piece-number" aria-hidden="true">{tile + 1}</span>}
          </button>;
        })}
      </div>
      <PhotoCredit photo={photo} />
    </div>
    <div className="game-side">
      <p className="game-kicker">Nine pieces. One memory.</p>
      <h3 ref={resultHeading} tabIndex={-1}>{solved ? 'Back together.' : 'Put the moment back together.'}</h3>
      <p className="game-instruction">{solved ? `You restored this photograph in ${moves} ${moves === 1 ? 'swap' : 'swaps'}. A little piece of history, complete.` : 'Choose two pieces to swap them. Small numbers show where each piece belongs.'}</p>
      <div className="puzzle-progress" aria-live="polite" aria-atomic="true">
        <strong>{matched}<span> / 9 in place</span></strong>
        <span>{moves} {moves === 1 ? 'swap' : 'swaps'}</span>
      </div>
      <progress max="9" value={matched} aria-label={`${matched} of 9 pieces in place`} />
      <div className="game-controls">
        {!solved && <button type="button" className="game-button" aria-pressed={preview} onClick={() => { setPreview(value => !value); setSelected(null); }}>{preview ? 'Back to puzzle' : 'Peek at the photo'}</button>}
        <button type="button" className="game-text-button" onClick={shuffle}>{solved ? 'Play this photo again ↻' : 'Shuffle again ↻'}</button>
      </div>
      <p className="game-footnote">Choose another memory from the photo strip below.</p>
    </div>
  </div>;
}

export function PhotoPuzzle(props: { photo: Photograph; onComplete?: () => void }) {
  return <PuzzleRound key={props.photo.id} {...props} />;
}

function makeDeck(photos: Photograph[]) {
  const years = [...new Set(photos.map(photo => photo.year))];
  return shuffledTiles(years.length).slice(0, 5).map(index => {
    const candidates = photos.filter(photo => photo.year === years[index]);
    const photo = candidates[Math.floor(Math.random() * candidates.length)];
    return { photo, choices: yearChoices(photo.year, years) };
  });
}

export function YearQuiz({ photos, onPhotoChange }: { photos: Photograph[]; onPhotoChange?: (photo: Photograph) => void }) {
  const [deck, setDeck] = useState(() => makeDeck(photos));
  const [round, setRound] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const callback = useRef(onPhotoChange);
  callback.current = onPhotoChange;
  const question = deck[round];
  useEffect(() => { if (question) callback.current?.(question.photo); }, [question]);
  useEffect(() => { if (answer !== null) nextButton.current?.focus(); }, [answer]);
  useEffect(() => {
    if (moveFocus.current) {
      questionHeading.current?.focus();
      moveFocus.current = false;
    }
  }, [round, finished, deck]);
  if (!question) return <p>No dated photographs are available yet.</p>;
  const { photo, choices } = question;
  const answered = answer !== null;

  function choose(year: number) {
    if (answered || finished) return;
    setAnswer(year);
    if (year === photo.year) setScore(current => current + 1);
  }
  function next() {
    moveFocus.current = true;
    if (round === deck.length - 1) { setFinished(true); return; }
    setRound(current => current + 1);
    setAnswer(null);
  }
  function restart() {
    moveFocus.current = true;
    setDeck(makeDeck(photos));
    setRound(0);
    setAnswer(null);
    setScore(0);
    setFinished(false);
  }

  return <div className="year-quiz">
    <div className="quiz-picture">
      <div className="quiz-photo"><img src={photo.src} srcSet={photo.srcSet} sizes="(max-width: 650px) 90vw, 440px" alt={answered ? photo.caption : 'Jensen Huang at a public appearance. Guess the year.'} width={photo.width} height={photo.height} /></div>
      <PhotoCredit photo={photo} />
    </div>
    <div className="game-side">
      <p className="game-kicker">{finished ? 'The memories add up.' : `Memory ${round + 1} of ${deck.length} · ${score} correct`}</p>
      <h3 ref={questionHeading} tabIndex={-1} aria-label={finished ? `Quiz complete. ${score} out of ${deck.length} correct.` : `Memory ${round + 1} of ${deck.length}. What year was this?`}>{finished ? `${score} out of ${deck.length}.` : 'What year was this?'}</h3>
      {finished ? <>
        <p className="game-instruction">{score === deck.length ? 'You know your NVIDIA history. Every memory, right where it belongs.' : 'Some moments stay with us. Others are worth discovering all over again.'}</p>
        <button type="button" className="game-button" onClick={restart}>Another five memories ↻</button>
      </> : <>
        <p className="game-instruction">A face, a stage, a moment in time. Take your best guess.</p>
        <div className="quiz-options" aria-label="Choose the photograph year">
          {choices.map(year => <button key={year} type="button" disabled={answered} onClick={() => choose(year)}
            className={`year-option${answered && year === photo.year ? ' is-right' : ''}${answer === year && year !== photo.year ? ' is-wrong' : ''}`}>
            {year}{answered && year === photo.year ? ' ✓' : answer === year ? ' ×' : ''}
          </button>)}
        </div>
        <div className="quiz-feedback" role="status" aria-live="polite">
          {answered && <><strong>{answer === photo.year ? 'That’s the one.' : `This one was ${photo.year}.`}</strong><span>{photo.caption}</span></>}
        </div>
        {answered && <button ref={nextButton} className="game-text-button quiz-next" type="button" onClick={next}>{round === deck.length - 1 ? 'See your score' : 'Next memory'} <span aria-hidden="true">→</span></button>}
      </>}
    </div>
  </div>;
}
