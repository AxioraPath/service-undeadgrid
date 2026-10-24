import { Controller, Get } from '@nestjs/common';
import { RoomService } from '../room/room.service';

/**
 * Endpoint de salud. El frontend lo consulta en `/health` (ver useServerStatus
 * y el proxy de Vite) para medir latencia y disponibilidad mientras no hay socket.
 */
@Controller()
export class HealthController {
  constructor(private readonly rooms: RoomService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      rooms: this.rooms.all().length,
      at: Date.now(),
    };
  }
}
