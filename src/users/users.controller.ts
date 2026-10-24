import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard, type AuthedRequest } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  preferredSurvivor?: string;
}

@Controller('me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@Req() req: AuthedRequest) {
    return this.users.getMe(req.user!.sub);
  }

  @Get('stats')
  stats(@Req() req: AuthedRequest) {
    return this.users.getStats(req.user!.sub);
  }

  @Patch()
  update(@Req() req: AuthedRequest, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(req.user!.sub, dto);
  }
}
