import type {
  DatabaseProviderDefinition,
  DatabaseProviderFactory,
  DatabaseProviderRuntime,
} from "./provider.js";
import type { WorkbenchCapability } from "./capabilities.js";
import { hasCapability } from "./capabilities.js";

interface RegisteredProvider {
  readonly definition: DatabaseProviderDefinition;
  readonly factory?: DatabaseProviderFactory;
}

export class ProviderRegistry {
  readonly #providers = new Map<string, RegisteredProvider>();

  register(
    definition: DatabaseProviderDefinition,
    factory?: DatabaseProviderFactory,
  ): void {
    if (this.#providers.has(definition.id)) {
      throw new Error(`Provider '${definition.id}' is already registered.`);
    }

    const provider: RegisteredProvider = factory
      ? { definition, factory }
      : { definition };

    this.#providers.set(definition.id, provider);
  }

  get(id: string): DatabaseProviderDefinition | undefined {
    return this.#providers.get(id)?.definition;
  }

  require(id: string): DatabaseProviderDefinition {
    const definition = this.get(id);
    if (!definition) {
      throw new Error(`Unknown database provider '${id}'.`);
    }
    return definition;
  }

  list(): readonly DatabaseProviderDefinition[] {
    return [...this.#providers.values()]
      .map(({ definition }) => definition)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  supporting(capability: WorkbenchCapability): readonly DatabaseProviderDefinition[] {
    return this.list().filter((definition) =>
      hasCapability(definition.capabilities, capability),
    );
  }

  planning(capability: WorkbenchCapability): readonly DatabaseProviderDefinition[] {
    return this.list().filter((definition) =>
      hasCapability(definition.plannedCapabilities ?? [], capability),
    );
  }

  createRuntime(id: string): DatabaseProviderRuntime {
    const provider = this.#providers.get(id);
    if (!provider) {
      throw new Error(`Unknown database provider '${id}'.`);
    }
    if (!provider.factory) {
      throw new Error(`Provider '${id}' does not yet expose a runtime factory.`);
    }
    return provider.factory();
  }
}
