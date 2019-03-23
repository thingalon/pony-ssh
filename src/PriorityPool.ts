import { EventEmitter } from "events";
import { default as PriorityQueue } from 'ts-priority-queue';

interface Waiter<T> {
    priority: number;
    resolve: ( item: T ) => void;
    reject: ( err: Error ) => void;
}

export class PriorityPool<T> extends EventEmitter {

    allItems: T[];
    availableItems: T[];
    waiters: PriorityQueue<Waiter<T>>;

    constructor() {
        super();

        this.allItems = [];
        this.availableItems = [];
        this.waiters = new PriorityQueue<Waiter<T>>( {
            comparator: ( a: Waiter<T>, b: Waiter<T> ): number => {
                return a.priority - b.priority;
            },
        } );
    }

    public add( item: T ) {
        this.allItems.push( item );
        this.checkin( item );
    }

    public async checkout( priority: number ): Promise<T> {
        return new Promise<T>( ( resolve, reject ) => {
            if ( this.availableItems.length > 0 ) {
                return resolve( this.availableItems.shift()! );
            }

            this.waiters.queue( {
                priority: priority,
                resolve: resolve,
                reject: reject,
            } );
        } );
    }

    public checkin( item: T ) {
        if ( this.waiters.length > 0 ) {
            const waiter = this.waiters.dequeue();
            return waiter.resolve( item );
        }

        this.availableItems.push( item );
    }

}