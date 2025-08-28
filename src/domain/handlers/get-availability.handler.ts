import { CACHE_MANAGER, Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Cache } from 'cache-manager';
import * as moment from 'moment';

import {
  ClubWithAvailability,
  GetAvailabilityQuery,
} from '../commands/get-availaiblity.query';
import {
  ALQUILA_TU_CANCHA_CLIENT,
  AlquilaTuCanchaClient,
} from '../ports/aquila-tu-cancha.client';

@QueryHandler(GetAvailabilityQuery)
export class GetAvailabilityHandler
  implements IQueryHandler<GetAvailabilityQuery>
{
  constructor(
    @Inject(ALQUILA_TU_CANCHA_CLIENT)
    private alquilaTuCanchaClient: AlquilaTuCanchaClient,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async execute(query: GetAvailabilityQuery): Promise<ClubWithAvailability[]> {
    const dateString = moment(query.date).format('YYYY-MM-DD');
    const cacheKey = `disponibilidad:${query.placeId}:${dateString}`;
    const fallbackCacheKey = `disponibilidad-fallback:${query.placeId}:${dateString}`;
    const cached = await this.cacheManager.get<ClubWithAvailability[]>(
      cacheKey,
    );
    if (cached) {
      console.log(`cache obtenido: ${cacheKey}`);
      return cached;
    }
    console.log(`[Cache MISS] por key: ${cacheKey}`);
    try {
      const clubs_with_availability: ClubWithAvailability[] = [];
      const clubs = await this.alquilaTuCanchaClient.getClubs(query.placeId);
      for (const club of clubs) {
        await this.cacheManager.set(`club_place:${club.id}`, query.placeId, {
          ttl: 86400,
        });
        const courts = await this.alquilaTuCanchaClient.getCourts(club.id);
        const courts_with_availability: ClubWithAvailability['courts'] = [];
        for (const court of courts) {
          const slots = await this.alquilaTuCanchaClient.getAvailableSlots(
            club.id,
            court.id,
            query.date,
          );
          courts_with_availability.push({
            ...court,
            available: slots,
          });
        }
        clubs_with_availability.push({
          ...club,
          courts: courts_with_availability,
        });
      }
      await this.cacheManager.set(cacheKey, clubs_with_availability);
      await this.cacheManager.set(fallbackCacheKey, clubs_with_availability);
      console.log(`[Cache SET] por key: ${cacheKey}`);
      return clubs_with_availability;
    } catch (error) {
      console.error('falla el mockeo API', error);
      const fallbackData = await this.cacheManager.get<ClubWithAvailability[]>(
        fallbackCacheKey,
      );

      if (fallbackData) {
        console.log(
          `[Fallback Cache HIT] devolviendo el dato anterior: ${fallbackCacheKey}`,
        );
        await this.cacheManager.set(cacheKey, fallbackData, { ttl: 60 });
        return fallbackData;
      }
    }
    console.log(
      'No hay datos en caché de respaldo y API falla por ende se devuelve un array vacío',
    );
    return [];
  }
}
