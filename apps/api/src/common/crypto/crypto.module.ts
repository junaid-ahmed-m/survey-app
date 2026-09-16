import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { CodeGeneratorService } from './code-generator.service';

@Global()
@Module({
  providers: [CryptoService, CodeGeneratorService],
  exports: [CryptoService, CodeGeneratorService],
})
export class CryptoModule {}
