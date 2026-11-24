// Shape of the npm registry packument — only the fields in use, all optional:
// old packages lack many of them.

export interface NpmPerson {
  name?: string;
  email?: string;
  trustedPublisher?: { id?: string; oidcConfigId?: string };
}

export type RepositoryField = string | { type?: string; url?: string };

export interface VersionManifest {
  version?: string;
  _npmUser?: NpmPerson;
  maintainers?: (NpmPerson | string)[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  dist?: {
    fileCount?: number;
    unpackedSize?: number;
    integrity?: string;
    tarball?: string;
    attestations?: { provenance?: { predicateType?: string } };
  };
  gitHead?: string;
  repository?: RepositoryField;
}

export interface Packument {
  name?: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, VersionManifest>;
  time?: Record<string, unknown>;
  maintainers?: (NpmPerson | string)[];
  repository?: RepositoryField;
}
