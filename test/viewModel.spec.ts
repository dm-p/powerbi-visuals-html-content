import { ViewModelHandler } from '../src/ViewModel';


describe('View Model', () => {

    describe('| Initialisation', () => {
    
        it('| Empty view model', () => {

            const vm = new ViewModelHandler();
            expect(vm.viewModel).toEqual({
                isValid: false,
                isEmpty: true,
                htmlEntries: []
            });

        });

    });

});