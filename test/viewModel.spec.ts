// Power BI API Dependencies
    import powerbi from 'powerbi-visuals-api';
    import DataView = powerbi.DataView;

// Internal dependencies
    import { ViewModelHandler, IViewModel } from '../src/ViewModel';
    import { VisualSettings } from '../src/VisualSettings';

// Seed constants for tests
    const 
        vmEmpty: IViewModel = {
            isValid: false,
            isEmpty: true,
            htmlEntries: []
        },
        dataViewEmpty: DataView[] = [],
        dataViewNoValues: DataView[] = [
            {
                table: {
                    columns: [],
                    rows: []
                },
                metadata: null
            }
        ],
        dataViewSimpleValues: DataView[] = [
            {
                table: {
                    columns: [],
                    rows: [
                        [
                            "<p>This is value <b>one</b></p>"
                        ],
                        [
                            "<p>This is value <b>two</b></p>"
                        ],
                        [
                            "<p>This is value <b>three</b></p>"
                        ]
                    ]
                },
                metadata: null
            }
        ];

// Common setup
    function newVm(): ViewModelHandler {
        return new ViewModelHandler();
    }
    function newVmValidate(dv: DataView[]): ViewModelHandler {
        const vm = newVm();
        vm.validateDataView(dv);
        return vm;
    }
    function newVmValidateMap(dv: DataView[]): ViewModelHandler {
        const vm = newVmValidate(dv);
        vm.mapDataView(dv, VisualSettings.parse(dv[0]));
        return vm;
    }

// View model unit tests
    describe('View Model', () => {

        describe('| Initialisation', () => {
        
            it('| Empty view model', () => {
                expect(newVm().viewModel).toEqual(vmEmpty);
            });

        });

        describe('| Validate data view', () => {

            it('| Empty data view', () => {
                expect(newVmValidate(dataViewEmpty).viewModel.isValid).toBeFalse();
            });

            it('| Valid data view with no results', () => {
                expect(newVmValidate(dataViewNoValues).viewModel.isValid).toBeTrue();
            });

            it('| Valid data view with some results', () => {
                expect(newVmValidate(dataViewSimpleValues).viewModel.isValid).toBeTrue();
            });

        });

        describe('| Map data view', () => {

            it('| Empty data view', () => {
                expect(newVmValidateMap(dataViewEmpty).viewModel).toEqual(vmEmpty);
            });

            it('| Valid data view with no results', () => {
                const vm = newVmValidateMap(dataViewNoValues);
                expect(vm.viewModel.isEmpty).toBeTrue();
                expect(vm.viewModel.htmlEntries.length).toEqual(0);
            });

            it('| Valid data view with some results', () => {
                const vm = newVmValidateMap(dataViewSimpleValues);
                expect(vm.viewModel.isEmpty).toBeFalse();
                expect(vm.viewModel.htmlEntries.length).toEqual(3);
            });

        });

        // TODO: Settings

    });