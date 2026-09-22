export type TmdbSeasonEpisodeCount = { episode_count: number; season_number: number };
export type TmdbEpisodeCoordinate = { episodeNumber: number; seasonNumber: number };

export function mapEpisodeOrdinalToTmdb(
  ordinal: number,
  seasons: TmdbSeasonEpisodeCount[],
): TmdbEpisodeCoordinate | null {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) return null;

  const regularSeasons = seasons
    .filter((season) => Number.isSafeInteger(season.season_number)
      && season.season_number > 0
      && Number.isSafeInteger(season.episode_count)
      && season.episode_count > 0)
    .sort((left, right) => left.season_number - right.season_number);

  let remaining = ordinal;
  for (const season of regularSeasons) {
    if (remaining <= season.episode_count) {
      return { episodeNumber: remaining, seasonNumber: season.season_number };
    }
    remaining -= season.episode_count;
  }
  return null;
}