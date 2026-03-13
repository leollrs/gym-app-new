import React from 'react';

const PlateCalculator = ({ targetWeight }) => {
  const barWeight = 45;
  const availablePlates = [45, 35, 25, 10, 5, 2.5];

  if (!targetWeight || targetWeight <= barWeight) {
    return <p className="text-[11px] text-[#9CA3AF] mt-1">Empty bar (45 lbs)</p>;
  }

  let remaining = (targetWeight - barWeight) / 2;
  const plates = [];
  for (const plate of availablePlates) {
    while (remaining >= plate) {
      plates.push(plate);
      remaining -= plate;
    }
  }

  if (remaining > 0) {
    // Not achievable exactly — find nearest
    const achievable = barWeight + plates.reduce((a, b) => a + b, 0) * 2;
    return (
      <p className="text-[11px] text-[#9CA3AF] mt-1">
        Nearest: {achievable} lbs — Each side: {plates.length > 0 ? plates.join(' + ') : 'none'}
      </p>
    );
  }

  return (
    <p className="text-[11px] text-[#9CA3AF] mt-1">
      Each side: {plates.join(' + ')}
    </p>
  );
};

export default PlateCalculator;
