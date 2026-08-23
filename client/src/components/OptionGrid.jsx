export default function OptionGrid({ id, options, selected, single = false, styleVariant = false, onSelect }) {
  const isSelected = (value) => (single ? selected === value : selected.includes(value));

  return (
    <div
      id={id}
      className={`option-grid${single ? ' single-select' : ''}${styleVariant ? ' style-grid' : ''}`}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`option-card${styleVariant ? ' style-card' : ''}${isSelected(opt.value) ? ' selected' : ''}`}
          onClick={() => onSelect(opt.value)}
        >
          <span className="option-emoji">{opt.emoji}</span>
          {styleVariant ? (
            <>
              <span className="option-title">{opt.title}</span>
              <span className="option-desc">{opt.desc}</span>
            </>
          ) : (
            opt.label
          )}
        </button>
      ))}
    </div>
  );
}
