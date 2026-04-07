import { TestBed } from '@angular/core/testing';

import { OpenprojectService } from './openproject.service';

describe('OpenprojectService', () => {
  let service: OpenprojectService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OpenprojectService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
