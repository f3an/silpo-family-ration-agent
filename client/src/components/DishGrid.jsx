function Macro({ label, value, unit }) {
  return (
    <div className="macro">
      <span className="macro-value">
        {value}
        {unit}
      </span>
      <span className="macro-label">{label}</span>
    </div>
  );
}

function DishCard({ dish, index, checked, onToggle, excludedIngredients, onToggleIngredient, onRequestSwap, swappingKey, isStale }) {
  return (
    <article className={`dish-card${isStale ? ' dish-card-stale' : ''}`}>
      <div className="dish-header">
        <h3>🍲 {dish.name}</h3>
        {isStale ? (
          <span className="badge dish-stale-badge">оновлено нижче ⬇</span>
        ) : (
          <label className="dish-select">
            <input type="checkbox" checked={checked} onChange={() => onToggle(index)} />
            додати
          </label>
        )}
      </div>

      <div className="dish-badges">
        <span className="badge">🍽️ {dish.cuisine || 'кухня не вказана'}</span>
        <span className="badge">⏱️ {dish.prepTimeMinutes} хв</span>
        {dish.daysCovered > 1 && <span className="badge">📦 на {dish.daysCovered} дн.</span>}
      </div>

      <div className="macros">
        <Macro label="ккал" value={dish.calories} unit="" />
        <Macro label="Б" value={dish.proteinGrams} unit="г" />
        <Macro label="Ж" value={dish.fatGrams} unit="г" />
        <Macro label="В" value={dish.carbsGrams} unit="г" />
      </div>

      <p className="dish-description">{dish.description}</p>

      <ul className="ingredient-list">
        {dish.ingredients.map((ing, i) => {
          const purchasable = Boolean(ing.productId);
          const key = `${index}:${i}`;
          const isExcluded = purchasable && excludedIngredients.has(key);
          return (
            <li
              key={i}
              className={[!purchasable && 'ingredient-unmatched', isExcluded && 'ingredient-excluded']
                .filter(Boolean)
                .join(' ')}
            >
              <span className="ingredient-checkbox-slot">
                {purchasable && !isStale && (
                  <input
                    type="checkbox"
                    className="ingredient-checkbox"
                    checked={!isExcluded}
                    onChange={() => onToggleIngredient(key)}
                    aria-label={`Купити: ${ing.name}`}
                  />
                )}
              </span>
              {ing.imageUrl ? (
                <img className="ingredient-thumb" src={ing.imageUrl} alt={ing.name} loading="lazy" />
              ) : (
                <span className="ingredient-thumb ingredient-thumb-placeholder" aria-hidden="true">
                  🛒
                </span>
              )}
              <span className="ingredient-text">
                {ing.name} — {ing.quantityLabel}
              </span>
              {!isStale && (
                <button
                  type="button"
                  className={`ingredient-swap-btn${!purchasable ? ' ingredient-swap-btn-missing' : ''}`}
                  aria-label={purchasable ? `Замінити: ${ing.name}` : `Знайти товар: ${ing.name}`}
                  title={purchasable ? 'Знайти заміну' : 'Товар не знайдено — підібрати варіанти'}
                  disabled={swappingKey === key}
                  onClick={() => onRequestSwap(index, i)}
                >
                  {swappingKey === key ? '⏳' : purchasable ? '🔄' : '🔍'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

export default function DishGrid({
  dishes,
  selectedIndexes,
  onToggle,
  excludedIngredients,
  onToggleIngredient,
  onRequestSwap,
  swappingKey,
  staleDishNames = new Set(),
}) {
  return (
    <div className="dish-grid">
      {dishes.map((dish, index) => (
        <DishCard
          key={index}
          dish={dish}
          index={index}
          checked={selectedIndexes.has(index)}
          onToggle={onToggle}
          excludedIngredients={excludedIngredients}
          onToggleIngredient={onToggleIngredient}
          onRequestSwap={onRequestSwap}
          swappingKey={swappingKey}
          isStale={staleDishNames.has(dish.name)}
        />
      ))}
    </div>
  );
}
