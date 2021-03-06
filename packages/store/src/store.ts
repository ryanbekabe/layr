import {
  Component,
  ensureComponentClass,
  assertIsComponentClass,
  assertIsComponentType,
  getComponentNameFromComponentClassType,
  getComponentNameFromComponentInstanceType,
  NormalizedIdentifierDescriptor,
  AttributeSelector,
  normalizeAttributeSelector,
  pickFromAttributeSelector
} from '@layr/component';
import {
  PlainObject,
  isPlainObject,
  deleteUndefinedProperties,
  assertNoUnknownOptions,
  PromiseLikeValue
} from 'core-helpers';
import {serialize, deserialize} from 'simple-serialization';
import cloneDeep from 'lodash/cloneDeep';

import {StorableLike, isStorableLikeClass, assertIsStorableLikeClass} from './storable-like';
import {
  Document,
  AttributeValue,
  Projection,
  buildProjection,
  DocumentPatch,
  buildDocumentPatch
} from './document';
import type {Query} from './query';
import type {Expression} from './expression';
import {Operator, looksLikeOperator, normalizeOperatorForValue} from './operator';
import type {Path} from './path';
import {isStoreInstance} from './utilities';

export type CreateDocumentParams = {
  collectionName: string;
  identifierDescriptor: NormalizedIdentifierDescriptor;
  document: Document;
};

export type ReadDocumentParams = {
  collectionName: string;
  identifierDescriptor: NormalizedIdentifierDescriptor;
  projection?: Projection;
};

export type UpdateDocumentParams = {
  collectionName: string;
  identifierDescriptor: NormalizedIdentifierDescriptor;
  documentPatch: DocumentPatch;
};

export type DeleteDocumentParams = {
  collectionName: string;
  identifierDescriptor: NormalizedIdentifierDescriptor;
};

export type FindDocumentsParams = {
  collectionName: string;
  expressions: Expression[];
  projection?: Projection;
  sort?: SortDescriptor;
  skip?: number;
  limit?: number;
};

export type CountDocumentsParams = {
  collectionName: string;
  expressions: Expression[];
};

export type SortDescriptor = {[name: string]: SortDirection};

export type SortDirection = 'asc' | 'desc';

export type TraceEntry = {
  operation: string;
  params: PlainObject;
  options: PlainObject | undefined;
  result?: any;
  error?: any;
};

/**
 * An abstract class from which classes such as [`MongoDBStore`](https://layrjs.com/docs/v1/reference/mongodb-store) or [`MemoryStore`](https://layrjs.com/docs/v1/reference/memory-store) are constructed. Unless you build a custom store, you probably won't have to use this class directly.
 */
export abstract class Store {
  constructor(options = {}) {
    assertNoUnknownOptions(options);
  }

  // === Root components ===

  _rootComponents = new Set<typeof Component>();

  /**
   * Registers all the [storable components](https://layrjs.com/docs/v1/reference/storable#storable-component-class) that are provided (directly or recursively) by the specified root component.
   *
   * @param rootComponent A [`Component`](https://layrjs.com/docs/v1/reference/component) class.
   *
   * @example
   * ```
   * import {Component} from '﹫layr/component';
   * import {Storable} from '﹫layr/storable';
   * import {MongoDBStore} from '﹫layr/mongodb-store';
   *
   * class User extends Storable(Component) {
   *   // ...
   * }
   *
   * class Movie extends Storable(Component) {
   *   // ...
   * }
   *
   * class Backend extends Component {
   *   ﹫provide() static User = User;
   *   ﹫provide() static Movie = Movie;
   * }
   *
   * const store = new MongoDBStore('mongodb://user:pass@host:port/db');
   *
   * store.registerRootComponent(Backend); // User and Movie will be registered
   * ```
   *
   * @category Component Registration
   */
  registerRootComponent(rootComponent: typeof Component) {
    assertIsComponentClass(rootComponent);

    this._rootComponents.add(rootComponent);

    let storableCount = 0;

    const registerIfComponentIsStorable = (component: typeof Component) => {
      if (isStorableLikeClass(component)) {
        this.registerStorable(component);
        storableCount++;
      }
    };

    registerIfComponentIsStorable(rootComponent);

    for (const providedComponent of rootComponent.getProvidedComponents({deep: true})) {
      registerIfComponentIsStorable(providedComponent);
    }

    if (storableCount === 0) {
      throw new Error(
        `No storable components were found from the specified root component '${rootComponent.describeComponent()}'`
      );
    }
  }

  /**
   * Gets all the root components that are registered into the store.
   *
   * @returns An iterator of [`Component`](https://layrjs.com/docs/v1/reference/component) classes.
   *
   * @category Component Registration
   */
  getRootComponents() {
    return this._rootComponents.values();
  }

  // === Storables ===

  _storables = new Map<string, typeof StorableLike>();

  /**
   * Gets a [storable component](https://layrjs.com/docs/v1/reference/storable#storable-component-class) that is registered into the store. An error is thrown if there is no storable component with the specified name.
   *
   * @param name The name of the storable component to get.
   *
   * @returns A [`StorableComponent`](https://layrjs.com/docs/v1/reference/storable#storable-component-class) class.
   *
   * @example
   * ```
   * // See the definition of `store` in the `registerRootComponent()` example
   *
   * store.getStorable('Movie'); // => Movie class
   * store.getStorable('User'); // => User class
   * store.getStorable('Film'); // => Error
   * ```
   *
   * @category Component Registration
   */
  getStorable(name: string) {
    const storable = this._getStorable(name);

    if (storable !== undefined) {
      return storable;
    }

    throw new Error(`The storable component '${name}' is not registered in the store`);
  }

  /**
   * Returns whether a [storable component](https://layrjs.com/docs/v1/reference/storable#storable-component-class) is registered into the store.
   *
   * @param name The name of the storable component to check.
   *
   * @returns A boolean.
   *
   * @example
   * ```
   * // See the definition of `store` in the `registerRootComponent()` example
   *
   * store.hasStorable('Movie'); // => true
   * store.hasStorable('User'); // => true
   * store.hasStorable('Film'); // => false
   * ```
   *
   * @category Component Registration
   */
  hasStorable(name: string) {
    return this._getStorable(name) !== undefined;
  }

  _getStorable(name: string) {
    return this._storables.get(name);
  }

  getStorableOfType(type: string) {
    const storable = this._getStorableOfType(type);

    if (storable !== undefined) {
      return storable;
    }

    throw new Error(`The storable component of type '${type}' is not registered in the store`);
  }

  _getStorableOfType(type: string) {
    const isComponentClassType = assertIsComponentType(type) === 'componentClassType';

    const componentName = isComponentClassType
      ? getComponentNameFromComponentClassType(type)
      : getComponentNameFromComponentInstanceType(type);

    const component = this._getStorable(componentName);

    if (component === undefined) {
      return undefined;
    }

    return isComponentClassType ? component : component.prototype;
  }

  /**
   * Registers a specific [storable component](https://layrjs.com/docs/v1/reference/storable#storable-component-class) into the store. Typically, instead of using this method, you would rather use the [`registerRootComponent()`](https://layrjs.com/docs/v1/reference/store#register-root-component-instance-method) method to register multiple storable components at once.
   *
   * @param storable The [`StorableComponent`](https://layrjs.com/docs/v1/reference/storable#storable-component-class) class to register.
   *
   * @example
   * ```
   * class Movie extends Storable(Component) {
   *   // ...
   * }
   *
   * const store = new MongoDBStore('mongodb://user:pass@host:port/db');
   *
   * store.registerStorable(Movie);
   * ```
   *
   * @category Component Registration
   */
  registerStorable(storable: typeof StorableLike) {
    assertIsStorableLikeClass(storable);

    if (storable.hasStore()) {
      if (storable.getStore() === this) {
        return;
      }

      throw new Error(
        `Cannot register a storable component that is already registered in another store (${storable.describeComponent()})`
      );
    }

    const storableName = storable.getComponentName();

    const existingStorable = this._storables.get(storableName);

    if (existingStorable !== undefined) {
      throw new Error(
        `A storable component with the same name is already registered (${existingStorable.describeComponent()})`
      );
    }

    storable.__setStore(this);

    this._storables.set(storableName, storable);
  }

  /**
   * Gets all the [storable components](https://layrjs.com/docs/v1/reference/storable#storable-component-class) that are registered into the store.
   *
   * @returns An iterator of [`StorableComponent`](https://layrjs.com/docs/v1/reference/storable#storable-component-class) classes.
   *
   * @category Component Registration
   */
  getStorables() {
    return this._storables.values();
  }

  // === Collections ===

  _getCollectionNameFromStorable(storable: typeof StorableLike | StorableLike) {
    return ensureComponentClass(storable).getComponentName();
  }

  // === Document operations ===

  async load(
    params: {storableType: string; identifierDescriptor: NormalizedIdentifierDescriptor},
    options: {attributeSelector?: AttributeSelector; throwIfMissing?: boolean} = {}
  ) {
    return await this._runOperation('load', params, options, async () => {
      const {storableType, identifierDescriptor} = params;
      let {attributeSelector = true, throwIfMissing = true} = options;

      attributeSelector = normalizeAttributeSelector(attributeSelector);

      const storable = this.getStorableOfType(storableType);
      const collectionName = this._getCollectionNameFromStorable(storable);

      const documentIdentifierDescriptor = this.toDocument(storable, identifierDescriptor);
      const documentAttributeSelector = this.toDocument(storable, attributeSelector);
      const projection = buildProjection(documentAttributeSelector);

      let document = await this.readDocument({
        collectionName,
        identifierDescriptor: documentIdentifierDescriptor,
        projection
      });

      if (document !== undefined) {
        document = pickFromAttributeSelector(document, documentAttributeSelector, {
          includeAttributeNames: ['__component']
        });

        const serializedStorable = this.fromDocument(storable, document);

        return serializedStorable;
      }

      if (!throwIfMissing) {
        return undefined;
      }

      throw Object.assign(
        new Error(
          `Cannot load a component that is missing from the store (${storable.describeComponent()}, ${ensureComponentClass(
            storable
          ).describeIdentifierDescriptor(identifierDescriptor)})`
        ),
        {code: 'COMPONENT_IS_MISSING_FROM_STORE', expose: true}
      );
    });
  }

  async save(
    params: {
      storableType: string;
      identifierDescriptor: NormalizedIdentifierDescriptor;
      serializedStorable: object;
      isNew?: boolean;
    },
    options: {throwIfMissing?: boolean; throwIfExists?: boolean} = {}
  ) {
    return await this._runOperation('save', params, options, async () => {
      const {storableType, identifierDescriptor, serializedStorable, isNew = false} = params;
      const {throwIfMissing = !isNew, throwIfExists = isNew} = options;

      if (throwIfMissing === true && throwIfExists === true) {
        throw new Error(
          "The 'throwIfMissing' and 'throwIfExists' options cannot be both set to true"
        );
      }

      const storable = this.getStorableOfType(storableType);
      const collectionName = this._getCollectionNameFromStorable(storable);

      const documentIdentifierDescriptor = this.toDocument(storable, identifierDescriptor);
      const document = this.toDocument(storable, serializedStorable);

      let wasSaved: boolean;

      if (isNew) {
        deleteUndefinedProperties(document);

        wasSaved = await this.createDocument({
          collectionName,
          identifierDescriptor: documentIdentifierDescriptor,
          document
        });
      } else {
        const documentPatch = buildDocumentPatch(document);

        wasSaved = await this.updateDocument({
          collectionName,
          identifierDescriptor: documentIdentifierDescriptor,
          documentPatch
        });
      }

      if (!wasSaved) {
        if (throwIfMissing) {
          throw Object.assign(
            new Error(
              `Cannot save a non-new component that is missing from the store (${storable.describeComponent()}, ${ensureComponentClass(
                storable
              ).describeIdentifierDescriptor(identifierDescriptor)})`
            ),
            {code: 'COMPONENT_IS_MISSING_FROM_STORE', expose: true}
          );
        }

        if (throwIfExists) {
          throw Object.assign(
            new Error(
              `Cannot save a new component that already exists in the store (${storable.describeComponent()}, ${ensureComponentClass(
                storable
              ).describeIdentifierDescriptor(identifierDescriptor)})`
            ),
            {code: 'COMPONENT_ALREADY_EXISTS_IN_STORE', expose: true}
          );
        }
      }

      return wasSaved;
    });
  }

  async delete(
    params: {storableType: string; identifierDescriptor: NormalizedIdentifierDescriptor},
    options: {throwIfMissing?: boolean} = {}
  ) {
    return await this._runOperation('delete', params, options, async () => {
      const {storableType, identifierDescriptor} = params;
      const {throwIfMissing = true} = options;

      const storable = this.getStorableOfType(storableType);
      const collectionName = this._getCollectionNameFromStorable(storable);

      const documentIdentifierDescriptor = this.toDocument(storable, identifierDescriptor);

      const wasDeleted = await this.deleteDocument({
        collectionName,
        identifierDescriptor: documentIdentifierDescriptor
      });

      if (!wasDeleted) {
        if (throwIfMissing) {
          throw Object.assign(
            new Error(
              `Cannot delete a component that is missing from the store (${storable.describeComponent()}, ${ensureComponentClass(
                storable
              ).describeIdentifierDescriptor(identifierDescriptor)})`
            ),
            {code: 'COMPONENT_IS_MISSING_FROM_STORE', expose: true}
          );
        }
      }

      return wasDeleted;
    });
  }

  async find(
    params: {
      storableType: string;
      query?: Query;
      sort?: SortDescriptor;
      skip?: number;
      limit?: number;
    },
    options: {attributeSelector?: AttributeSelector} = {}
  ) {
    return await this._runOperation('find', params, options, async () => {
      const {storableType, query = {}, sort = {}, skip, limit} = params;
      let {attributeSelector = true} = options;

      attributeSelector = normalizeAttributeSelector(attributeSelector);

      const storable = this.getStorableOfType(storableType);
      const collectionName = this._getCollectionNameFromStorable(storable);

      const documentExpressions = this.toDocumentExpressions(storable, query);
      const documentSort = this.toDocument(storable, sort);
      const documentAttributeSelector = this.toDocument(storable, attributeSelector);
      const projection = buildProjection(documentAttributeSelector);

      let documents = await this.findDocuments({
        collectionName,
        expressions: documentExpressions,
        projection,
        sort: documentSort,
        skip,
        limit
      });

      documents = documents.map((document) =>
        pickFromAttributeSelector(document, documentAttributeSelector, {
          includeAttributeNames: ['__component']
        })
      );

      const serializedStorables = documents.map((document) =>
        this.fromDocument(storable, document)
      );

      return serializedStorables;
    });
  }

  async count(params: {storableType: string; query?: Query}) {
    return await this._runOperation('find', params, undefined, async () => {
      const {storableType, query = {}} = params;

      const storable = this.getStorableOfType(storableType);
      const collectionName = this._getCollectionNameFromStorable(storable);

      const documentExpressions = this.toDocumentExpressions(storable, query);

      const documentsCount = await this.countDocuments({
        collectionName,
        expressions: documentExpressions
      });

      return documentsCount;
    });
  }

  async _runOperation<
    PromiseResult extends Promise<unknown>,
    Result = PromiseLikeValue<PromiseResult>
  >(
    operation: string,
    params: PlainObject,
    options: PlainObject | undefined,
    func: () => PromiseResult
  ): Promise<Result> {
    const trace = this._trace;

    try {
      const result = await func();

      if (trace !== undefined) {
        trace.push({operation, params: cloneDeep(params), options: cloneDeep(options), result});
      }

      return result as Result;
    } catch (error) {
      if (trace !== undefined) {
        trace.push({operation, params: cloneDeep(params), options: cloneDeep(options), error});
      }

      throw error;
    }
  }

  // === Tracing ===

  _trace: TraceEntry[] | undefined;

  getTrace() {
    const trace = this._trace;

    if (trace === undefined) {
      throw new Error('The store is not currently tracing');
    }

    return trace;
  }

  startTrace() {
    this._trace = [];
  }

  stopTrace() {
    this._trace = undefined;
  }

  // === Abstract document operations ===

  abstract async createDocument({
    collectionName,
    identifierDescriptor,
    document
  }: CreateDocumentParams): Promise<boolean>;

  abstract async readDocument({
    collectionName,
    identifierDescriptor,
    projection
  }: ReadDocumentParams): Promise<Document | undefined>;

  abstract async updateDocument({
    collectionName,
    identifierDescriptor,
    documentPatch
  }: UpdateDocumentParams): Promise<boolean>;

  abstract async deleteDocument({
    collectionName,
    identifierDescriptor
  }: DeleteDocumentParams): Promise<boolean>;

  abstract async findDocuments({
    collectionName,
    expressions,
    projection,
    sort,
    skip,
    limit
  }: FindDocumentsParams): Promise<Document[]>;

  abstract async countDocuments({
    collectionName,
    expressions
  }: CountDocumentsParams): Promise<number>;

  // === Serialization ===

  toDocument<Value>(_storable: typeof StorableLike | StorableLike, value: Value) {
    return deserialize(value) as Value;
  }

  // {a: 1, b: {c: 2}} => [['a', '$equal', 1], ['b.c', '$equal', 2]]
  toDocumentExpressions(storable: typeof StorableLike | StorableLike, query: Query) {
    const documentQuery = this.toDocument(storable, query);

    const build = function (query: Query, expressions: Expression[], path: Path) {
      for (const [name, value] of Object.entries(query)) {
        if (looksLikeOperator(name)) {
          const operator = name;

          if (operator === '$and' || operator === '$or' || operator === '$nor') {
            handleOperator(operator, value, expressions, path, {query});
            continue;
          }

          throw new Error(
            `A query cannot contain the operator '${operator}' at its root (query: ${JSON.stringify(
              query
            )})`
          );
        }

        const subpath: Path = path !== '' ? `${path}.${name}` : name;

        handleValue(value, expressions, subpath, {query});
      }
    };

    const handleValue = function (
      value: AttributeValue | object,
      expressions: Expression[],
      subpath: Path,
      {query}: {query: Query}
    ) {
      if (!isPlainObject(value)) {
        // Make '$equal' the default operator for non object values
        expressions.push([subpath, '$equal', value]);
        return;
      }

      const object = value;

      let objectContainsAttributes = false;
      let objectContainsOperators = false;

      for (const name of Object.keys(object)) {
        if (looksLikeOperator(name)) {
          objectContainsOperators = true;
        } else {
          objectContainsAttributes = true;
        }
      }

      if (objectContainsAttributes) {
        if (objectContainsOperators) {
          throw new Error(
            `A subquery cannot contain both an attribute and an operator (subquery: ${JSON.stringify(
              object
            )})`
          );
        }

        const subquery = object;
        build(subquery, expressions, subpath);
        return;
      }

      if (objectContainsOperators) {
        const operators = object;

        for (const [operator, value] of Object.entries(operators)) {
          handleOperator(operator, value, expressions, subpath, {query});
        }
      }
    };

    const handleOperator = function (
      operator: Operator,
      value: AttributeValue | object,
      expressions: Expression[],
      path: Path,
      {query}: {query: Query}
    ) {
      const normalizedOperator = normalizeOperatorForValue(operator, value, {query});

      if (
        normalizedOperator === '$some' ||
        normalizedOperator === '$every' ||
        normalizedOperator === '$not'
      ) {
        const subexpressions: Expression[] = [];
        handleValue(value, subexpressions, '', {query});
        expressions.push([path, normalizedOperator, subexpressions]);
        return;
      }

      if (
        normalizedOperator === '$and' ||
        normalizedOperator === '$or' ||
        normalizedOperator === '$nor'
      ) {
        const values = value as (AttributeValue | object)[];
        const operatorExpressions = values.map((value) => {
          const subexpressions: Expression[] = [];
          handleValue(value, subexpressions, '', {query});
          return subexpressions;
        });
        expressions.push([path, normalizedOperator, operatorExpressions]);
        return;
      }

      if (isPlainObject(value)) {
        throw new Error(
          `Unexpected object encountered in a query (query: ${JSON.stringify(query)})`
        );
      }

      expressions.push([path, normalizedOperator, value]);
    };

    const documentExpressions: Expression[] = [];
    build(documentQuery, documentExpressions, '');
    return documentExpressions;
  }

  fromDocument(_storable: typeof StorableLike | StorableLike, document: Document): Document {
    return serialize(document);
  }

  // === Utilities ===

  static isStore(value: any): value is Store {
    return isStoreInstance(value);
  }
}
