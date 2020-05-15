import {Component} from './component';
import {attribute} from './decorators';
import {serialize} from './serialization';

describe('Serialization', () => {
  test('Component classes', async () => {
    class BaseMovie extends Component {}

    expect(BaseMovie.serialize()).toStrictEqual({__component: 'typeof BaseMovie'});

    class Movie extends BaseMovie {
      @attribute() static limit = 100;
      @attribute() static offset: number;
    }

    expect(Movie.serialize()).toStrictEqual({
      __component: 'typeof Movie',
      limit: 100,
      offset: {__undefined: true}
    });

    expect(Movie.serialize({attributeSelector: {limit: true}})).toStrictEqual({
      __component: 'typeof Movie',
      limit: 100
    });

    expect(Movie.serialize({returnComponentReferences: true})).toStrictEqual({
      __component: 'typeof Movie'
    });

    // --- With nested components ---

    class Cinema extends Component {
      @attribute() static limit = 100;

      @attribute() static MovieClass = Movie;
    }

    expect(Cinema.serialize()).toStrictEqual({
      __component: 'typeof Cinema',
      limit: 100,
      MovieClass: {__component: 'typeof Movie'}
    });

    let referencedComponents: Set<typeof Component> = new Set();

    expect(Cinema.serialize({referencedComponents})).toStrictEqual({
      __component: 'typeof Cinema',
      limit: 100,
      MovieClass: {__component: 'typeof Movie'}
    });
    expect(Array.from(referencedComponents)).toStrictEqual([Movie]);

    referencedComponents = new Set();

    expect(Cinema.serialize({returnComponentReferences: true, referencedComponents})).toStrictEqual(
      {
        __component: 'typeof Cinema'
      }
    );
    expect(Array.from(referencedComponents)).toStrictEqual([Cinema]);
  });

  test('Component instances', async () => {
    class Movie extends Component {
      @attribute() title = '';
      @attribute() director?: Director;
    }

    let movie = new Movie();

    expect(movie.serialize()).toStrictEqual({
      __component: 'Movie',
      __new: true,
      title: '',
      director: {__undefined: true}
    });

    expect(movie.serialize({attributeSelector: {title: true}})).toStrictEqual({
      __component: 'Movie',
      __new: true,
      title: ''
    });

    expect(movie.serialize({includeIsNewMarks: false})).toStrictEqual({
      __component: 'Movie',
      title: '',
      director: {__undefined: true}
    });

    movie = Movie.instantiate();

    expect(movie.serialize()).toStrictEqual({
      __component: 'Movie'
    });

    expect(movie.serialize({includeComponentTypes: false})).toStrictEqual({});

    movie.title = 'Inception';

    expect(movie.serialize()).toStrictEqual({
      __component: 'Movie',
      title: 'Inception'
    });

    expect(movie.serialize({includeComponentTypes: false})).toStrictEqual({title: 'Inception'});

    // // --- With nested components ---

    class Director extends Component {
      @attribute() name?: string;
      @attribute() country?: string;
    }

    movie.director = new Director({name: 'Christopher Nolan'});

    expect(movie.serialize()).toStrictEqual({
      __component: 'Movie',
      title: 'Inception',
      director: {
        __component: 'Director',
        __new: true,
        name: 'Christopher Nolan',
        country: {__undefined: true}
      }
    });

    expect(
      movie.serialize({attributeSelector: {title: true, director: {name: true}}})
    ).toStrictEqual({
      __component: 'Movie',
      title: 'Inception',
      director: {__component: 'Director', __new: true, name: 'Christopher Nolan'}
    });

    expect(movie.serialize({attributeSelector: {title: true, director: {}}})).toStrictEqual({
      __component: 'Movie',
      title: 'Inception',
      director: {__component: 'Director', __new: true}
    });

    expect(movie.serialize({includeIsNewMarks: false})).toStrictEqual({
      __component: 'Movie',
      title: 'Inception',
      director: {__component: 'Director', name: 'Christopher Nolan', country: {__undefined: true}}
    });

    expect(movie.serialize({includeComponentTypes: false, includeIsNewMarks: false})).toStrictEqual(
      {
        title: 'Inception',
        director: {name: 'Christopher Nolan', country: {__undefined: true}}
      }
    );

    expect(
      movie.serialize({
        attributeFilter(attribute) {
          expect(this).toBe(movie);
          expect(attribute.getParent()).toBe(movie);
          return attribute.getName() === 'title';
        }
      })
    ).toStrictEqual({
      __component: 'Movie',
      title: 'Inception'
    });

    expect(
      await movie.serialize({
        async attributeFilter(attribute) {
          expect(this).toBe(movie);
          expect(attribute.getParent()).toBe(movie);
          return attribute.getName() === 'title';
        }
      })
    ).toStrictEqual({
      __component: 'Movie',
      title: 'Inception'
    });
  });

  test('Functions', async () => {
    function sum(a: number, b: number) {
      return a + b;
    }

    expect(serialize(sum)).toStrictEqual({});
    expect(trimSerializedFunction(serialize(sum, {serializeFunctions: true}))).toStrictEqual({
      __function: 'function sum(a, b) {\nreturn a + b;\n}'
    });

    sum.displayName = 'sum';

    expect(serialize(sum)).toStrictEqual({displayName: 'sum'});
    expect(trimSerializedFunction(serialize(sum, {serializeFunctions: true}))).toStrictEqual({
      __function: 'function sum(a, b) {\nreturn a + b;\n}',
      displayName: 'sum'
    });

    sum.__context = {x: 1, y: 2};

    expect(serialize(sum)).toStrictEqual({displayName: 'sum', __context: {x: 1, y: 2}});
    expect(trimSerializedFunction(serialize(sum, {serializeFunctions: true}))).toStrictEqual({
      __function: 'function sum(a, b) {\nreturn a + b;\n}',
      displayName: 'sum',
      __context: {x: 1, y: 2}
    });

    function trimSerializedFunction(serializedFunction: any) {
      return {
        ...serializedFunction,
        __function: serializedFunction.__function.replace(/\n +/g, '\n')
      };
    }
  });
});