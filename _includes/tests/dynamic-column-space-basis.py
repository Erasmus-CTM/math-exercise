def test(check, symbols):
    def score(B):
        return check({"inputs": {"B": {"matrix": B}}}, symbols)["score"]
    B = Matrix([[1, 2], [0, 1], [1, 3]])
    assert score(B) == 1
    assert score(B.T[::-1,:].T if 'columns' == "columns" else B[::-1,:]) == 1
    incomplete = B[:,:1] if 'columns' == "columns" else B[:1,:]
    assert 0 < score(incomplete) < 1
    dependent = B.row_join(B[:,:1]) if 'columns' == "columns" else B.col_join(B[:1,:])
    assert score(dependent) < 1
    assert score(zeros(B.rows,B.cols)) == 0
    assert score(I*B) < 1
    assert score(zeros(0,0)) == 0
